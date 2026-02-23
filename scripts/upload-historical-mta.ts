/**
 * Upload Historical MTA Data to S3
 *
 * One-time script that reads MTA open-data CSVs, converts them to Parquet,
 * and uploads both the Parquet and raw CSV to S3.
 *
 * Run with:
 *   npx tsx scripts/upload-historical-mta.ts
 *   npx tsx scripts/upload-historical-mta.ts --dry-run
 *
 * Requires:
 *   - S3_ANALYTICS_BUCKET env var (or .env file)
 *   - AWS credentials configured (env vars, profile, or IAM role)
 *   - npm install @aws-sdk/client-s3 @dsnp/parquetjs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'csv-parse/sync';
import { ParquetSchema, ParquetWriter } from '@dsnp/parquetjs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DatasetConfig {
  /** Human-readable name for logging */
  name: string;
  /** CSV filename inside the source directory */
  csvFilename: string;
  /** S3 prefix under the bucket (no leading/trailing slash) */
  s3Prefix: string;
  /** Parquet schema definition */
  schema: ParquetSchema;
  /** Transform a raw CSV record (string values) into typed Parquet row */
  transform: (row: Record<string, string>) => Record<string, unknown>;
}

interface UploadResult {
  name: string;
  csvFile: string;
  rowCount: number;
  parquetBytes: number;
  csvBytes: number;
  parquetUploaded: boolean;
  csvUploaded: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip commas from number strings: "4,050,989" -> 4050989 */
function parseIntWithCommas(value: string): number | null {
  if (!value || value.trim() === '') return null;
  const cleaned = value.replace(/,/g, '').trim();
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

/** Parse float, stripping commas: "1,234.56" -> 1234.56 */
function parseFloatWithCommas(value: string): number | null {
  if (!value || value.trim() === '') return null;
  const cleaned = value.replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/** Parse percentage string: "76.2%" -> 76.2, plain numbers pass through */
function parsePercentage(value: string): number | null {
  if (!value || value.trim() === '') return null;
  const cleaned = value.replace(/%/g, '').replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Normalize date string to ISO-8601: MM/DD/YYYY -> YYYY-MM-DD
 * Also handles M/D/YYYY, MM/DD/YY, and already-ISO dates.
 */
function normalizeDate(value: string): string | null {
  if (!value || value.trim() === '') return null;
  const trimmed = value.trim();

  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.substring(0, 10);
  }

  // MM/DD/YYYY or M/D/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const month = slashMatch[1].padStart(2, '0');
    const day = slashMatch[2].padStart(2, '0');
    let year = slashMatch[3];
    if (year.length === 2) {
      year = parseInt(year, 10) > 50 ? `19${year}` : `20${year}`;
    }
    return `${year}-${month}-${day}`;
  }

  return trimmed;
}

/** Trim whitespace, return null for empty strings */
function trimOrNull(value: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// ---------------------------------------------------------------------------
// Dataset Configurations
// ---------------------------------------------------------------------------

const CSV_SOURCE_DIR = process.argv[2] ?? 'C:\\Users\\User\\Downloads\\mtaData';

const DATASETS: DatasetConfig[] = [
  // 1. Daily Ridership and Traffic
  // Columns: Date, Mode, Count
  // Sample: "02/19/2026","Subway","4,050,989"
  {
    name: 'Daily Ridership',
    csvFilename: 'MTA_Daily_Ridership_and_Traffic__Beginning_2020_20260223.csv',
    s3Prefix: 'historical/daily_ridership',
    schema: new ParquetSchema({
      date: { type: 'UTF8' },
      mode: { type: 'UTF8' },
      count: { type: 'INT64' },
    }),
    transform: (row) => ({
      date: normalizeDate(row['Date'] ?? '') ?? '',
      mode: trimOrNull(row['Mode'] ?? '') ?? '',
      count: parseIntWithCommas(row['Count'] ?? '') ?? 0,
    }),
  },

  // 2. Terminal On-Time Performance
  // Columns: month, division, line, day_type, num_on_time_trips, num_sched_trips, terminal_on_time_performance
  // Sample: "2015-01-01","A DIVISION","1","1","6,874","9,017","76.2337806%"
  {
    name: 'Terminal On-Time Performance',
    csvFilename: 'MTA_Subway_Terminal_On-Time_Performance__2015-2019_20260223.csv',
    s3Prefix: 'historical/terminal_otp',
    schema: new ParquetSchema({
      month: { type: 'UTF8' },
      division: { type: 'UTF8' },
      line: { type: 'UTF8' },
      day_type: { type: 'UTF8' },
      num_on_time_trips: { type: 'INT64' },
      num_sched_trips: { type: 'INT64' },
      terminal_on_time_performance: { type: 'DOUBLE' },
    }),
    transform: (row) => ({
      month: normalizeDate(row['month'] ?? '') ?? (row['month'] ?? ''),
      division: trimOrNull(row['division'] ?? '') ?? '',
      line: trimOrNull(row['line'] ?? '') ?? '',
      day_type: trimOrNull(row['day_type'] ?? '') ?? '',
      num_on_time_trips: parseIntWithCommas(row['num_on_time_trips'] ?? '') ?? 0,
      num_sched_trips: parseIntWithCommas(row['num_sched_trips'] ?? '') ?? 0,
      terminal_on_time_performance: parsePercentage(row['terminal_on_time_performance'] ?? '') ?? 0.0,
    }),
  },

  // 3. Major Incidents
  // Columns: month, division, line, day_type, category, count
  // Sample: "2015-01-01","A DIVISION","1","1","Signals","1"
  {
    name: 'Major Incidents',
    csvFilename: 'MTA_Subway_Major_Incidents__2015-2019_20260223.csv',
    s3Prefix: 'historical/major_incidents',
    schema: new ParquetSchema({
      month: { type: 'UTF8' },
      division: { type: 'UTF8' },
      line: { type: 'UTF8' },
      day_type: { type: 'UTF8' },
      category: { type: 'UTF8' },
      incident_count: { type: 'INT64' },
    }),
    transform: (row) => ({
      month: normalizeDate(row['month'] ?? '') ?? (row['month'] ?? ''),
      division: trimOrNull(row['division'] ?? '') ?? '',
      line: trimOrNull(row['line'] ?? '') ?? '',
      day_type: trimOrNull(row['day_type'] ?? '') ?? '',
      category: trimOrNull(row['category'] ?? '') ?? '',
      incident_count: parseIntWithCommas(row['count'] ?? '') ?? 0,
    }),
  },

  // 4. Fare Evasion
  // Columns: Time Period, Fare Evasion, Margin of Error
  // Sample: "2018-Q1","2.8%",""
  {
    name: 'Fare Evasion',
    csvFilename: 'MTA_NYCT_Subway_Fare_Evasion__Beginning_2018_20260223.csv',
    s3Prefix: 'historical/fare_evasion',
    schema: new ParquetSchema({
      time_period: { type: 'UTF8' },
      fare_evasion_pct: { type: 'DOUBLE' },
      margin_of_error: { type: 'DOUBLE' },
    }),
    transform: (row) => ({
      time_period: trimOrNull(row['Time Period'] ?? '') ?? '',
      fare_evasion_pct: parsePercentage(row['Fare Evasion'] ?? '') ?? 0.0,
      margin_of_error: parsePercentage(row['Margin of Error'] ?? '') ?? 0.0,
    }),
  },

  // 5. Mean Distance Between Failures (MDBF)
  // Columns: Month, Division, Car Class, Total Miles, Number of Failures, Number of Cars, MDBF, 12-Month Average MDBF
  // Sample: "2026-01-01","A","R142","4,734,418","49","1,025","96621.0","138,051"
  {
    name: 'Mean Distance Between Failures',
    csvFilename: 'MTA_Subway_Mean_Distance_Between_Failures__Beginning_2015_20260223.csv',
    s3Prefix: 'historical/mdbf',
    schema: new ParquetSchema({
      month: { type: 'UTF8' },
      division: { type: 'UTF8' },
      car_class: { type: 'UTF8' },
      total_miles: { type: 'INT64' },
      number_of_failures: { type: 'INT64' },
      number_of_cars: { type: 'INT64' },
      mdbf: { type: 'DOUBLE' },
      twelve_month_avg_mdbf: { type: 'DOUBLE' },
    }),
    transform: (row) => ({
      month: normalizeDate(row['Month'] ?? '') ?? (row['Month'] ?? ''),
      division: trimOrNull(row['Division'] ?? '') ?? '',
      car_class: trimOrNull(row['Car Class'] ?? '') ?? '',
      total_miles: parseIntWithCommas(row['Total Miles'] ?? '') ?? 0,
      number_of_failures: parseIntWithCommas(row['Number of Failures'] ?? '') ?? 0,
      number_of_cars: parseIntWithCommas(row['Number of Cars'] ?? '') ?? 0,
      mdbf: parseFloatWithCommas(row['MDBF'] ?? '') ?? 0.0,
      twelve_month_avg_mdbf: parseFloatWithCommas(row['12-Month Average MDBF'] ?? '') ?? 0.0,
    }),
  },

  // 6. Customer Journey-Focused Metrics
  // Columns: month, division, line, period, num_passengers, additional platform time,
  //          additional train time, total_apt, total_att, over_five_mins, over_five_mins_perc,
  //          customer journey time performance
  // Sample: "2015-01-01","A DIVISION","1","peak","5,170,116.8","1.371437615","0.825561936",
  //         "7,090,492.655","4,268,251.636","580,364","11.2253557%","88.7746443%"
  {
    name: 'Customer Journey Metrics',
    csvFilename: 'MTA_Subway_Customer_Journey-Focused_Metrics__2015-2019_20260223.csv',
    s3Prefix: 'historical/customer_journey',
    schema: new ParquetSchema({
      month: { type: 'UTF8' },
      division: { type: 'UTF8' },
      line: { type: 'UTF8' },
      period: { type: 'UTF8' },
      num_passengers: { type: 'DOUBLE' },
      additional_platform_time: { type: 'DOUBLE' },
      additional_train_time: { type: 'DOUBLE' },
      total_apt: { type: 'DOUBLE' },
      total_att: { type: 'DOUBLE' },
      over_five_mins: { type: 'DOUBLE' },
      over_five_mins_pct: { type: 'DOUBLE' },
      customer_journey_time_performance: { type: 'DOUBLE' },
    }),
    transform: (row) => ({
      month: normalizeDate(row['month'] ?? '') ?? (row['month'] ?? ''),
      division: trimOrNull(row['division'] ?? '') ?? '',
      line: trimOrNull(row['line'] ?? '') ?? '',
      period: trimOrNull(row['period'] ?? '') ?? '',
      num_passengers: parseFloatWithCommas(row['num_passengers'] ?? '') ?? 0.0,
      additional_platform_time: parseFloatWithCommas(row['additional platform time'] ?? '') ?? 0.0,
      additional_train_time: parseFloatWithCommas(row['additional train time'] ?? '') ?? 0.0,
      total_apt: parseFloatWithCommas(row['total_apt'] ?? '') ?? 0.0,
      total_att: parseFloatWithCommas(row['total_att'] ?? '') ?? 0.0,
      over_five_mins: parseFloatWithCommas(row['over_five_mins'] ?? '') ?? 0.0,
      over_five_mins_pct: parsePercentage(row['over_five_mins_perc'] ?? '') ?? 0.0,
      customer_journey_time_performance: parsePercentage(row['customer journey time performance'] ?? '') ?? 0.0,
    }),
  },

  // 7. Service Delivered
  // Columns: month, division, line, day_type, num_sched_trains, num_actual_trains, service delivered
  // Sample: "2015-01-01","A DIVISION","1","1","1,630","1,608","98.6503067%"
  {
    name: 'Service Delivered',
    csvFilename: 'MTA_Subway_Service_Delivered__2015-2019_20260223.csv',
    s3Prefix: 'historical/service_delivered',
    schema: new ParquetSchema({
      month: { type: 'UTF8' },
      division: { type: 'UTF8' },
      line: { type: 'UTF8' },
      day_type: { type: 'UTF8' },
      num_sched_trains: { type: 'INT64' },
      num_actual_trains: { type: 'INT64' },
      service_delivered_pct: { type: 'DOUBLE' },
    }),
    transform: (row) => ({
      month: normalizeDate(row['month'] ?? '') ?? (row['month'] ?? ''),
      division: trimOrNull(row['division'] ?? '') ?? '',
      line: trimOrNull(row['line'] ?? '') ?? '',
      day_type: trimOrNull(row['day_type'] ?? '') ?? '',
      num_sched_trains: parseIntWithCommas(row['num_sched_trains'] ?? '') ?? 0,
      num_actual_trains: parseIntWithCommas(row['num_actual_trains'] ?? '') ?? 0,
      service_delivered_pct: parsePercentage(row['service delivered'] ?? '') ?? 0.0,
    }),
  },
];

// ---------------------------------------------------------------------------
// CSV Processing
// ---------------------------------------------------------------------------

function readAndParseCsv(
  filePath: string
): { headers: string[]; records: Record<string, string>[] } | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const headers = records.length > 0 ? Object.keys(records[0]) : [];
  return { headers, records };
}

// ---------------------------------------------------------------------------
// Parquet Writing
// ---------------------------------------------------------------------------

async function writeParquetToBuffer(
  schema: ParquetSchema,
  rows: Record<string, unknown>[]
): Promise<Buffer> {
  // @dsnp/parquetjs supports writing to a buffer via an output stream.
  // We write to a temp file and read it back, which is the most reliable
  // cross-platform approach for this library.
  const tmpFile = path.join(
    process.env.TEMP ?? process.env.TMP ?? '/tmp',
    `mta-parquet-${Date.now()}-${Math.random().toString(36).slice(2)}.parquet`
  );

  try {
    const writer = await ParquetWriter.openFile(schema, tmpFile);
    for (const row of rows) {
      await writer.appendRow(row);
    }
    await writer.close();

    const buffer = fs.readFileSync(tmpFile);
    return buffer;
  } finally {
    // Clean up temp file
    try {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ---------------------------------------------------------------------------
// S3 Upload
// ---------------------------------------------------------------------------

function createS3Client(): S3Client {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  return new S3Client({ region });
}

async function uploadToS3(
  client: S3Client,
  bucket: string,
  key: string,
  body: Buffer | string,
  contentType: string
): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: typeof body === 'string' ? Buffer.from(body, 'utf-8') : body,
    ContentType: contentType,
  });
  await client.send(command);
}

// ---------------------------------------------------------------------------
// Summary Table
// ---------------------------------------------------------------------------

function printSummaryTable(results: UploadResult[]): void {
  console.log('\n' + '='.repeat(100));
  console.log('UPLOAD SUMMARY');
  console.log('='.repeat(100));
  console.log(
    'Dataset'.padEnd(35) +
    'Rows'.padStart(10) +
    'Parquet'.padStart(12) +
    'CSV'.padStart(12) +
    'Parquet OK'.padStart(12) +
    'CSV OK'.padStart(10) +
    'Error'.padStart(10)
  );
  console.log('-'.repeat(100));

  let totalRows = 0;
  let totalParquet = 0;
  let totalCsv = 0;
  let successCount = 0;
  let errorCount = 0;

  for (const r of results) {
    totalRows += r.rowCount;
    totalParquet += r.parquetBytes;
    totalCsv += r.csvBytes;
    if (r.parquetUploaded && r.csvUploaded) successCount++;
    if (r.error) errorCount++;

    const parquetSize = r.parquetBytes > 0
      ? formatBytes(r.parquetBytes)
      : 'N/A';
    const csvSize = r.csvBytes > 0
      ? formatBytes(r.csvBytes)
      : 'N/A';

    console.log(
      r.name.padEnd(35) +
      r.rowCount.toLocaleString().padStart(10) +
      parquetSize.padStart(12) +
      csvSize.padStart(12) +
      (r.parquetUploaded ? 'YES' : 'NO').padStart(12) +
      (r.csvUploaded ? 'YES' : 'NO').padStart(10) +
      (r.error ? 'FAIL' : '').padStart(10)
    );
  }

  console.log('-'.repeat(100));
  console.log(
    'TOTAL'.padEnd(35) +
    totalRows.toLocaleString().padStart(10) +
    formatBytes(totalParquet).padStart(12) +
    formatBytes(totalCsv).padStart(12) +
    `${successCount}/${results.length}`.padStart(12) +
    ''.padStart(10) +
    (errorCount > 0 ? `${errorCount} err` : '').padStart(10)
  );
  console.log('='.repeat(100));
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const startTime = Date.now();
  const dryRun = process.argv.includes('--dry-run');
  const bucket = process.env.S3_ANALYTICS_BUCKET;

  if (!dryRun && !bucket) {
    console.error(
      'ERROR: S3_ANALYTICS_BUCKET environment variable is not set.\n' +
      'Set it or use --dry-run to validate CSVs without uploading.'
    );
    process.exit(1);
  }

  console.log(`Mode: ${dryRun ? 'DRY RUN (no uploads)' : 'LIVE UPLOAD'}`);
  if (bucket) {
    console.log(`Bucket: ${bucket}`);
  }
  console.log(`Source directory: ${CSV_SOURCE_DIR}`);
  console.log(`Datasets to process: ${DATASETS.length}\n`);

  const s3 = dryRun ? null : createS3Client();
  const results: UploadResult[] = [];

  for (const dataset of DATASETS) {
    const csvPath = path.join(CSV_SOURCE_DIR, dataset.csvFilename);
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Processing: ${dataset.name}`);
    console.log(`File: ${dataset.csvFilename}`);
    console.log(`S3 prefix: ${dataset.s3Prefix}/`);

    const result: UploadResult = {
      name: dataset.name,
      csvFile: dataset.csvFilename,
      rowCount: 0,
      parquetBytes: 0,
      csvBytes: 0,
      parquetUploaded: false,
      csvUploaded: false,
    };

    try {
      // Step 1: Read and parse CSV
      const csvData = readAndParseCsv(csvPath);
      if (!csvData) {
        console.warn(`  WARNING: File not found, skipping: ${csvPath}`);
        result.error = 'File not found';
        results.push(result);
        continue;
      }

      const { headers, records } = csvData;
      result.rowCount = records.length;
      result.csvBytes = fs.statSync(csvPath).size;

      console.log(`  Headers: [${headers.join(', ')}]`);
      console.log(`  Rows: ${records.length.toLocaleString()}`);
      console.log(`  CSV size: ${formatBytes(result.csvBytes)}`);

      // Log a sample row (first record, transformed)
      if (records.length > 0) {
        const sampleRaw = records[0];
        const sampleTransformed = dataset.transform(sampleRaw);
        console.log(`  Sample raw:         ${JSON.stringify(sampleRaw)}`);
        console.log(`  Sample transformed: ${JSON.stringify(sampleTransformed)}`);
      }

      // Step 2: Transform all rows
      console.log('  Transforming rows...');
      const transformedRows: Record<string, unknown>[] = [];
      let transformErrors = 0;

      for (let i = 0; i < records.length; i++) {
        try {
          transformedRows.push(dataset.transform(records[i]));
        } catch (err) {
          transformErrors++;
          if (transformErrors <= 3) {
            console.warn(
              `  WARNING: Transform error on row ${i + 1}: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      }

      if (transformErrors > 0) {
        console.warn(
          `  WARNING: ${transformErrors} row(s) had transform errors (skipped)`
        );
      }
      console.log(`  Transformed: ${transformedRows.length.toLocaleString()} rows`);

      if (dryRun) {
        console.log('  [DRY RUN] Skipping Parquet conversion and S3 upload.');
        result.parquetUploaded = false;
        result.csvUploaded = false;
        results.push(result);
        continue;
      }

      // Step 3: Write Parquet
      console.log('  Writing Parquet...');
      const parquetBuffer = await writeParquetToBuffer(
        dataset.schema,
        transformedRows
      );
      result.parquetBytes = parquetBuffer.length;
      console.log(`  Parquet size: ${formatBytes(result.parquetBytes)}`);

      // Step 4: Derive filenames for S3
      const baseName = path.basename(dataset.csvFilename, '.csv');
      const parquetKey = `${dataset.s3Prefix}/${baseName}.parquet`;
      const rawCsvKey = `${dataset.s3Prefix}/raw/${dataset.csvFilename}`;

      // Step 5: Upload Parquet
      console.log(`  Uploading Parquet -> s3://${bucket}/${parquetKey}`);
      try {
        await uploadToS3(
          s3!,
          bucket!,
          parquetKey,
          parquetBuffer,
          'application/octet-stream'
        );
        result.parquetUploaded = true;
        console.log('  Parquet uploaded successfully.');
      } catch (err) {
        console.error(
          `  ERROR uploading Parquet: ${err instanceof Error ? err.message : String(err)}`
        );
        result.error = `Parquet upload failed: ${err instanceof Error ? err.message : String(err)}`;
      }

      // Step 6: Upload raw CSV
      console.log(`  Uploading CSV -> s3://${bucket}/${rawCsvKey}`);
      try {
        const csvBuffer = fs.readFileSync(csvPath);
        await uploadToS3(
          s3!,
          bucket!,
          rawCsvKey,
          csvBuffer,
          'text/csv'
        );
        result.csvUploaded = true;
        console.log('  CSV uploaded successfully.');
      } catch (err) {
        console.error(
          `  ERROR uploading CSV: ${err instanceof Error ? err.message : String(err)}`
        );
        if (!result.error) {
          result.error = `CSV upload failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    } catch (err) {
      console.error(
        `  ERROR processing ${dataset.name}: ${err instanceof Error ? err.message : String(err)}`
      );
      result.error = err instanceof Error ? err.message : String(err);
    }

    results.push(result);
  }

  // Print summary
  printSummaryTable(results);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nCompleted in ${elapsed}s`);

  // Exit with error code if any dataset failed
  const hasErrors = results.some((r) => r.error);
  if (hasErrors) {
    console.log('\nSome datasets had errors. Review the log above.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
