"""
Railtime Daily Rollup ETL

Reads yesterday's raw metrics + events from S3, computes daily per-route
aggregates, and writes rollups to both DynamoDB and S3 Parquet.
"""

import sys
from datetime import datetime, timedelta

import boto3
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from pyspark.sql import functions as F

# ---------------------------------------------------------------------------
# Job arguments
# ---------------------------------------------------------------------------

args = getResolvedOptions(sys.argv, [
    "JOB_NAME",
    "S3_BUCKET",
    "METRICS_TABLE",
    "ROLLUPS_TABLE",
    "EVENTS_TABLE",
])

sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args["JOB_NAME"], args)

BUCKET = args["S3_BUCKET"]
METRICS_TABLE = args["METRICS_TABLE"]
ROLLUPS_TABLE = args["ROLLUPS_TABLE"]
EVENTS_TABLE = args["EVENTS_TABLE"]

# ---------------------------------------------------------------------------
# Date range: yesterday
# ---------------------------------------------------------------------------

yesterday = datetime.utcnow() - timedelta(days=1)
year = yesterday.strftime("%Y")
month = yesterday.strftime("%m")
day = yesterday.strftime("%d")
date_str = yesterday.strftime("%Y-%m-%d")

metrics_path = f"s3://{BUCKET}/raw/metrics/year={year}/month={month}/day={day}/"
events_path = f"s3://{BUCKET}/raw/events/year={year}/month={month}/day={day}/"

# ---------------------------------------------------------------------------
# Read raw metrics
# ---------------------------------------------------------------------------

try:
    metrics_df = spark.read.json(metrics_path)
except Exception as e:
    print(f"[daily-rollup] No metrics data for {date_str}: {e}")
    job.commit()
    sys.exit(0)

if metrics_df.rdd.isEmpty():
    print(f"[daily-rollup] No metrics records for {date_str}")
    job.commit()
    sys.exit(0)

# ---------------------------------------------------------------------------
# Read raw events (for alert counts)
# ---------------------------------------------------------------------------

alert_counts = {}
try:
    events_df = spark.read.json(events_path)
    if not events_df.rdd.isEmpty():
        # Count alert events per route
        alert_df = events_df.filter(F.col("pk").startswith("ALERT#"))
        alert_df = alert_df.withColumn(
            "routeId",
            F.regexp_replace(F.col("pk"), "^ALERT#", ""),
        )
        alert_agg = alert_df.groupBy("routeId").count().collect()
        alert_counts = {row["routeId"]: row["count"] for row in alert_agg}
except Exception as e:
    print(f"[daily-rollup] No events data for {date_str}: {e}")

# ---------------------------------------------------------------------------
# Compute daily rollups per route
# ---------------------------------------------------------------------------

rollup_df = metrics_df.groupBy("routeId").agg(
    F.avg("avgDelaySeconds").alias("avgDelay"),
    F.avg("onTimePercent").alias("onTimePercent"),
    F.max("trainCount").alias("peakTrainCount"),
    F.avg("headwayAvgSeconds").alias("avgHeadway"),
    F.count("*").alias("totalTrips"),
)

rollups = rollup_df.collect()

# ---------------------------------------------------------------------------
# Write to DynamoDB
# ---------------------------------------------------------------------------

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(ROLLUPS_TABLE)

with table.batch_writer() as batch:
    for row in rollups:
        route_id = row["routeId"]
        item = {
            "routeId": route_id,
            "date": date_str,
            "avgDelay": round(float(row["avgDelay"]), 1) if row["avgDelay"] else None,
            "onTimePercent": round(float(row["onTimePercent"]), 1) if row["onTimePercent"] else None,
            "peakTrainCount": int(row["peakTrainCount"]) if row["peakTrainCount"] else None,
            "totalAlerts": alert_counts.get(route_id, 0),
            "avgHeadway": round(float(row["avgHeadway"]), 1) if row["avgHeadway"] else None,
            "totalTrips": int(row["totalTrips"]) if row["totalTrips"] else None,
        }
        # Remove None values for DynamoDB
        item = {k: v for k, v in item.items() if v is not None}
        batch.put_item(Item=item)

print(f"[daily-rollup] Wrote {len(rollups)} rollup records to DynamoDB")

# ---------------------------------------------------------------------------
# Write to S3 as Parquet
# ---------------------------------------------------------------------------

rollup_with_date = rollup_df.withColumn("date", F.lit(date_str))

# Add alert counts
alert_udf_map = alert_counts

@F.udf("integer")
def get_alert_count(route_id):
    return alert_udf_map.get(route_id, 0)

rollup_with_date = rollup_with_date.withColumn(
    "totalAlerts", get_alert_count(F.col("routeId"))
)

parquet_path = f"s3://{BUCKET}/rollups/daily/year={year}/month={month}/{date_str}.parquet"
rollup_with_date.write.mode("overwrite").parquet(parquet_path)

print(f"[daily-rollup] Wrote Parquet to {parquet_path}")

job.commit()
