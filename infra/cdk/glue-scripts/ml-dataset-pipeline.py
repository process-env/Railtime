"""
Railtime ML Dataset Pipeline

Daily PySpark ETL job (AWS Glue 4.0) that runs at 02:00 UTC, one hour
after the daily-rollup job.  Produces five ML dataset families in the ML
bucket, drawing from both historical Parquet tables and real-time NDJSON
in the analytics bucket.

Dataset families:
  1. ridership_forecast    — historical daily ridership with calendar features
  2. reliability_analysis  — MDBF, OTP, incidents, service joined by month
  3. delay_prediction      — supervised: real-time metrics + events with delay target
  4. anomaly_detection     — unsupervised: same features, no target column
  5. position_trajectory   — per-trip position streams with segment speeds
"""

import sys
import math
import logging
from datetime import datetime, timedelta

from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from pyspark.sql import functions as F
from pyspark.sql.types import DoubleType
from pyspark.sql.window import Window

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# ---------------------------------------------------------------------------
# Job arguments
# ---------------------------------------------------------------------------

args = getResolvedOptions(sys.argv, ["JOB_NAME", "ANALYTICS_BUCKET", "ML_BUCKET"])
ANALYTICS_BUCKET = args["ANALYTICS_BUCKET"]
ML_BUCKET = args["ML_BUCKET"]

# ---------------------------------------------------------------------------
# Glue / Spark initialisation
# ---------------------------------------------------------------------------

sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args["JOB_NAME"], args)

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def safe_read_parquet(path):
    """Read a Parquet dataset.  Returns None when the path does not exist or
    contains zero rows."""
    try:
        df = spark.read.parquet(path)
        if df.head(1):
            return df
        return None
    except Exception:
        logger.info("No data at %s, skipping", path)
        return None


def safe_read_json(path):
    """Read NDJSON / JSON Lines.  Returns None when the path does not exist or
    contains zero rows."""
    try:
        df = spark.read.json(path)
        if df.head(1):
            return df
        return None
    except Exception:
        logger.info("No data at %s, skipping", path)
        return None


def get_recent_date_paths(base_path, days=7):
    """Generate Hive-partitioned date paths for the most recent *days* days."""
    paths = []
    now = datetime.utcnow()
    for d in range(days):
        dt = now - timedelta(days=d)
        paths.append(
            f"{base_path}/year={dt.year}/month={dt.month:02d}/day={dt.day:02d}/"
        )
    return paths


def read_recent_json(base_path, days=7):
    """Read NDJSON across the last N days of Hive-partitioned paths.  Returns
    None when none of the paths yield data."""
    paths = get_recent_date_paths(base_path, days)
    frames = []
    for p in paths:
        df = safe_read_json(p)
        if df is not None:
            frames.append(df)
    if not frames:
        return None
    result = frames[0]
    for f in frames[1:]:
        result = result.unionByName(f, allowMissingColumns=True)
    return result


# ---------------------------------------------------------------------------
# Haversine UDF (used by position_trajectory)
# ---------------------------------------------------------------------------


@F.udf(returnType=DoubleType())
def haversine_km(lat1, lon1, lat2, lon2):
    """Return the great-circle distance in kilometres between two points given
    as decimal degrees.  Returns None when any input is None."""
    if lat1 is None or lon1 is None or lat2 is None or lon2 is None:
        return None
    R = 6371.0  # Earth radius in km
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(d_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


# ===========================================================================
# Dataset 1: ridership_forecast  (historical)
# ===========================================================================


def build_ridership_forecast():
    """Historical daily ridership with calendar features for time-series
    forecasting (e.g. Prophet, XGBoost)."""
    logger.info("Building ridership_forecast dataset")
    try:
        df = spark.read.parquet(
            f"s3://{ANALYTICS_BUCKET}/historical/daily_ridership/"
        )
        if not df.head(1):
            logger.warning("No ridership data found, skipping")
            return

        result = (
            df.filter(F.lower(F.col("mode")).contains("subway"))
            .select(
                F.col("date"),
                F.col("count").alias("ridership"),
            )
            .withColumn("parsed_date", F.to_date("date", "yyyy-MM-dd"))
            .withColumn("day_of_week", F.dayofweek("parsed_date"))
            .withColumn("month", F.month("parsed_date"))
            .withColumn("year", F.year("parsed_date"))
            .withColumn("is_weekend", F.dayofweek("parsed_date").isin([1, 7]))
            .drop("parsed_date")
            .filter(F.col("ridership").isNotNull())
        )

        result.write.mode("overwrite").partitionBy("year", "month").parquet(
            f"s3://{ML_BUCKET}/datasets/ridership_forecast/"
        )

        logger.info("ridership_forecast: %d rows written", result.count())
    except Exception as e:
        logger.error("Failed to build ridership_forecast: %s", e)


# ===========================================================================
# Dataset 2: reliability_analysis  (historical)
# ===========================================================================


def build_reliability_analysis():
    """Monthly reliability metrics: MDBF, OTP, incident counts, and service
    delivery percentages joined by month and division."""
    logger.info("Building reliability_analysis dataset")
    try:
        mdbf = spark.read.parquet(
            f"s3://{ANALYTICS_BUCKET}/historical/mdbf/"
        )
        if not mdbf.head(1):
            logger.warning("No MDBF data found, skipping")
            return

        otp = safe_read_parquet(
            f"s3://{ANALYTICS_BUCKET}/historical/terminal_otp/"
        )
        incidents = safe_read_parquet(
            f"s3://{ANALYTICS_BUCKET}/historical/major_incidents/"
        )
        service = safe_read_parquet(
            f"s3://{ANALYTICS_BUCKET}/historical/service_delivered/"
        )

        # Start with MDBF as base
        result = mdbf.select("month", "car_class", "division", "mdbf").withColumn(
            "year", F.year(F.to_date("month", "yyyy-MM-dd"))
        ).withColumn(
            "month_num", F.month(F.to_date("month", "yyyy-MM-dd"))
        )

        # Join OTP if available (on month + division)
        if otp is not None:
            otp_agg = otp.groupBy("month", "division").agg(
                F.avg("terminal_on_time_performance").alias("otp_pct")
            )
            result = result.join(otp_agg, ["month", "division"], "left")

        # Join incidents if available (aggregate monthly count by division)
        if incidents is not None:
            inc_agg = incidents.groupBy("month", "division").agg(
                F.sum("incident_count").alias("total_incidents")
            )
            result = result.join(inc_agg, ["month", "division"], "left")

        # Join service if available (on month, approximate by division)
        if service is not None:
            svc_agg = service.groupBy("month").agg(
                F.avg("service_delivered_pct").alias("service_pct")
            )
            result = result.join(svc_agg, ["month"], "left")

        result.write.mode("overwrite").partitionBy("year", "month_num").parquet(
            f"s3://{ML_BUCKET}/datasets/reliability_analysis/"
        )

        logger.info("reliability_analysis: %d rows written", result.count())
    except Exception as e:
        logger.error("Failed to build reliability_analysis: %s", e)


# ===========================================================================
# Dataset 3: delay_prediction  (real-time, supervised)
# ===========================================================================


def build_delay_prediction():
    """Supervised dataset: per-route 5-minute windows with headway, train count,
    event counts, and a delay_seconds target derived from avgDelaySeconds."""
    logger.info("Building delay_prediction dataset")
    try:
        metrics_base = f"s3://{ANALYTICS_BUCKET}/raw/metrics"
        events_base = f"s3://{ANALYTICS_BUCKET}/raw/events"

        metrics = read_recent_json(metrics_base, days=7)
        if metrics is None:
            logger.info("No recent metrics data, skipping delay_prediction")
            return

        events = read_recent_json(events_base, days=7)

        # --- Metrics features ---
        metrics_feat = (
            metrics.withColumn(
                "ts",
                F.from_unixtime(F.col("timestamp") / 1000).cast("timestamp"),
            )
            .withColumn(
                "window_start",
                F.window("ts", "5 minutes").getField("start"),
            )
            .withColumn("hour", F.hour("ts"))
            .withColumn("day_of_week", F.dayofweek(F.to_date("ts")))
            .groupBy("routeId", "window_start", "hour", "day_of_week")
            .agg(
                F.avg("headwayAvgSeconds").alias("headway_avg"),
                F.max("trainCount").alias("train_count"),
                F.avg("avgDelaySeconds").alias("delay_seconds"),
            )
        )

        # --- Events features (optional) ---
        if events is not None:
            events_feat = (
                events.withColumn(
                    "ts",
                    F.from_unixtime(F.col("timestamp") / 1000).cast("timestamp"),
                )
                .withColumn(
                    "window_start",
                    F.window("ts", "5 minutes").getField("start"),
                )
                .withColumn(
                    "routeId",
                    F.regexp_replace(F.col("pk"), "^[A-Z]+#", ""),
                )
                .withColumn(
                    "event_type",
                    F.regexp_extract(F.col("pk"), "^([A-Z]+)#", 1),
                )
                .groupBy("routeId", "window_start")
                .agg(
                    F.count("*").alias("event_count"),
                    F.sum(
                        F.when(F.col("event_type") == "BUNCHING", 1).otherwise(0)
                    ).alias("bunching_count"),
                    F.sum(
                        F.when(F.col("event_type") == "GAP", 1).otherwise(0)
                    ).alias("gap_count"),
                    F.sum(
                        F.when(F.col("event_type") == "DELAY", 1).otherwise(0)
                    ).alias("delay_event_count"),
                    F.sum(
                        F.when(F.col("event_type") == "ALERT", 1).otherwise(0)
                    ).alias("alert_count"),
                )
            )

            result = metrics_feat.join(
                events_feat, ["routeId", "window_start"], "left"
            ).fillna(
                0,
                subset=[
                    "event_count",
                    "bunching_count",
                    "gap_count",
                    "delay_event_count",
                    "alert_count",
                ],
            )
            result = result.withColumn(
                "alert_active", F.col("alert_count") > 0
            )
        else:
            result = (
                metrics_feat.withColumn("event_count", F.lit(0))
                .withColumn("bunching_count", F.lit(0))
                .withColumn("gap_count", F.lit(0))
                .withColumn("delay_event_count", F.lit(0))
                .withColumn("alert_count", F.lit(0))
                .withColumn("alert_active", F.lit(False))
            )

        # Add partition columns
        result = result.withColumn(
            "year", F.year("window_start")
        ).withColumn("month", F.month("window_start"))

        result.write.mode("overwrite").partitionBy("year", "month").parquet(
            f"s3://{ML_BUCKET}/datasets/delay_prediction/"
        )

        logger.info("delay_prediction: %d rows written", result.count())
    except Exception as e:
        logger.error("Failed to build delay_prediction: %s", e)


# ===========================================================================
# Dataset 4: anomaly_detection  (real-time, unsupervised)
# ===========================================================================


def build_anomaly_detection():
    """Unsupervised dataset: same feature set as delay_prediction but without
    the delay_seconds target column.  Suitable for isolation forest, DBSCAN,
    or autoencoder anomaly detection."""
    logger.info("Building anomaly_detection dataset")
    try:
        metrics_base = f"s3://{ANALYTICS_BUCKET}/raw/metrics"
        events_base = f"s3://{ANALYTICS_BUCKET}/raw/events"

        metrics = read_recent_json(metrics_base, days=7)
        if metrics is None:
            logger.info("No recent metrics data, skipping anomaly_detection")
            return

        events = read_recent_json(events_base, days=7)

        # --- Metrics features ---
        metrics_feat = (
            metrics.withColumn(
                "ts",
                F.from_unixtime(F.col("timestamp") / 1000).cast("timestamp"),
            )
            .withColumn(
                "window_start",
                F.window("ts", "5 minutes").getField("start"),
            )
            .withColumn("hour", F.hour("ts"))
            .withColumn("day_of_week", F.dayofweek(F.to_date("ts")))
            .groupBy("routeId", "window_start", "hour", "day_of_week")
            .agg(
                F.avg("headwayAvgSeconds").alias("headway_avg"),
                F.max("trainCount").alias("train_count"),
                F.avg("onTimePercent").alias("on_time_pct"),
                F.stddev("headwayAvgSeconds").alias("headway_stddev"),
            )
        )

        # --- Events features (all event types as counts) ---
        if events is not None:
            events_feat = (
                events.withColumn(
                    "ts",
                    F.from_unixtime(F.col("timestamp") / 1000).cast("timestamp"),
                )
                .withColumn(
                    "window_start",
                    F.window("ts", "5 minutes").getField("start"),
                )
                .withColumn(
                    "routeId",
                    F.regexp_replace(F.col("pk"), "^[A-Z]+#", ""),
                )
                .withColumn(
                    "event_type",
                    F.regexp_extract(F.col("pk"), "^([A-Z]+)#", 1),
                )
                .groupBy("routeId", "window_start")
                .agg(
                    F.count("*").alias("event_count"),
                    F.sum(
                        F.when(F.col("event_type") == "BUNCHING", 1).otherwise(0)
                    ).alias("bunching_count"),
                    F.sum(
                        F.when(F.col("event_type") == "GAP", 1).otherwise(0)
                    ).alias("gap_count"),
                    F.sum(
                        F.when(F.col("event_type") == "DELAY", 1).otherwise(0)
                    ).alias("delay_event_count"),
                    F.sum(
                        F.when(F.col("event_type") == "ALERT", 1).otherwise(0)
                    ).alias("alert_count"),
                    F.sum(
                        F.when(F.col("event_type") == "SLOWZONE", 1).otherwise(0)
                    ).alias("slowzone_count"),
                    F.sum(
                        F.when(F.col("event_type") == "REROUTE", 1).otherwise(0)
                    ).alias("reroute_count"),
                )
            )

            result = metrics_feat.join(
                events_feat, ["routeId", "window_start"], "left"
            ).fillna(
                0,
                subset=[
                    "event_count",
                    "bunching_count",
                    "gap_count",
                    "delay_event_count",
                    "alert_count",
                    "slowzone_count",
                    "reroute_count",
                ],
            )
        else:
            result = (
                metrics_feat.withColumn("event_count", F.lit(0))
                .withColumn("bunching_count", F.lit(0))
                .withColumn("gap_count", F.lit(0))
                .withColumn("delay_event_count", F.lit(0))
                .withColumn("alert_count", F.lit(0))
                .withColumn("slowzone_count", F.lit(0))
                .withColumn("reroute_count", F.lit(0))
            )

        # Add partition columns
        result = result.withColumn(
            "year", F.year("window_start")
        ).withColumn("month", F.month("window_start"))

        result.write.mode("overwrite").partitionBy("year", "month").parquet(
            f"s3://{ML_BUCKET}/datasets/anomaly_detection/"
        )

        logger.info("anomaly_detection: %d rows written", result.count())
    except Exception as e:
        logger.error("Failed to build anomaly_detection: %s", e)


# ===========================================================================
# Dataset 5: position_trajectory  (real-time positions)
# ===========================================================================


def build_position_trajectory():
    """Per-trip position streams with computed segment speeds (km/h) between
    consecutive GPS reports.  Useful for speed-profile modelling and dwell-time
    estimation."""
    logger.info("Building position_trajectory dataset")
    try:
        positions_base = f"s3://{ANALYTICS_BUCKET}/raw/positions"

        positions = read_recent_json(positions_base, days=3)
        if positions is None:
            logger.info(
                "No recent position data, skipping position_trajectory"
            )
            return

        # Select relevant columns and cast types
        pos = positions.select(
            F.col("tripId").cast("string"),
            F.col("routeId").cast("string"),
            F.col("feedGroupId").cast("string"),
            F.col("lat").cast("double"),
            F.col("lon").cast("double"),
            F.col("heading").cast("double"),
            F.col("capturedAt").cast("long"),
        ).filter(
            F.col("tripId").isNotNull()
            & F.col("lat").isNotNull()
            & F.col("lon").isNotNull()
            & F.col("capturedAt").isNotNull()
        )

        # Window: per trip, ordered by capture time
        trip_window = Window.partitionBy("tripId").orderBy("capturedAt")

        pos_with_prev = (
            pos.withColumn("prev_lat", F.lag("lat").over(trip_window))
            .withColumn("prev_lon", F.lag("lon").over(trip_window))
            .withColumn(
                "prev_capturedAt", F.lag("capturedAt").over(trip_window)
            )
        )

        # Compute segment distance (km) and time delta (hours)
        pos_with_speed = pos_with_prev.withColumn(
            "segment_dist_km",
            haversine_km(
                F.col("prev_lat"),
                F.col("prev_lon"),
                F.col("lat"),
                F.col("lon"),
            ),
        ).withColumn(
            "time_delta_hours",
            F.when(
                F.col("prev_capturedAt").isNotNull(),
                (F.col("capturedAt") - F.col("prev_capturedAt")) / 3600000.0,
            ),
        )

        # segment_speed in km/h; guard against division by zero / tiny deltas
        result = (
            pos_with_speed.withColumn(
                "segment_speed",
                F.when(
                    (F.col("time_delta_hours").isNotNull())
                    & (F.col("time_delta_hours") > 0.0001)
                    & (F.col("segment_dist_km").isNotNull()),
                    F.col("segment_dist_km") / F.col("time_delta_hours"),
                ),
            )
            .select(
                "tripId",
                "routeId",
                "feedGroupId",
                "lat",
                "lon",
                "heading",
                "capturedAt",
                "segment_speed",
            )
            .withColumn(
                "year",
                F.year(
                    F.from_unixtime(F.col("capturedAt") / 1000).cast(
                        "timestamp"
                    )
                ),
            )
            .withColumn(
                "month",
                F.month(
                    F.from_unixtime(F.col("capturedAt") / 1000).cast(
                        "timestamp"
                    )
                ),
            )
        )

        result.write.mode("overwrite").partitionBy("year", "month").parquet(
            f"s3://{ML_BUCKET}/datasets/position_trajectory/"
        )

        logger.info("position_trajectory: %d rows written", result.count())
    except Exception as e:
        logger.error("Failed to build position_trajectory: %s", e)


# ===========================================================================
# Main execution
# ===========================================================================

logger.info(
    "Starting ML dataset pipeline  ANALYTICS_BUCKET=%s  ML_BUCKET=%s",
    ANALYTICS_BUCKET,
    ML_BUCKET,
)

# Historical datasets (always run)
build_ridership_forecast()
build_reliability_analysis()

# Real-time datasets (run if data exists)
build_delay_prediction()
build_anomaly_detection()
build_position_trajectory()

job.commit()
logger.info("ML dataset pipeline complete")
