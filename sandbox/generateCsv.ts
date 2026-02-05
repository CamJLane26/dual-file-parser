import * as fs from 'fs';
import * as path from 'path';
import { Writable } from 'stream';

// Sample data pools for generating realistic records
const firstNames = ['John', 'Jane', 'Michael', 'Sarah', 'David', 'Emily', 'Chris', 'Jessica', 'Daniel', 'Ashley'];
const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
const cities = ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'San Jose'];
const states = ['NY', 'CA', 'IL', 'TX', 'AZ', 'PA', 'TX', 'CA', 'TX', 'CA'];
const products = ['Laptop', 'Phone', 'Tablet', 'Monitor', 'Keyboard', 'Mouse', 'Headphones', 'Webcam', 'Speaker', 'Microphone'];
const statuses = ['active', 'inactive', 'pending', 'completed', 'cancelled'];

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number, decimals: number = 2): string {
  return (Math.random() * (max - min) + min).toFixed(decimals);
}

function randomDate(startYear: number = 2020, endYear: number = 2024): string {
  const year = randomInt(startYear, endYear);
  const month = String(randomInt(1, 12)).padStart(2, '0');
  const day = String(randomInt(1, 28)).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function randomEmail(firstName: string, lastName: string): string {
  const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'company.com', 'business.net'];
  return `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${randomElement(domains)}`;
}

function generateRandomRecord(id: number): string[] {
  const firstName = randomElement(firstNames);
  const lastName = randomElement(lastNames);
  
  return [
    String(id),                                    // id
    firstName,                                     // first_name
    lastName,                                      // last_name
    randomEmail(firstName, lastName),              // email
    randomElement(cities),                         // city
    randomElement(states),                         // state
    String(randomInt(10000, 99999)),               // zip_code
    randomElement(products),                       // product
    randomFloat(10, 999),                          // price
    String(randomInt(1, 100)),                     // quantity
    randomFloat(10, 99999),                        // total
    randomElement(statuses),                       // status
    randomDate(),                                  // order_date
    Math.random() > 0.5 ? 'true' : 'false',        // is_priority
    randomFloat(0, 5, 1),                          // rating
  ];
}

function escapeCSV(value: string): string {
  // If the value contains comma, quote, or newline, wrap it in quotes
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    // Escape quotes by doubling them
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function generateCSVFile(numRecords: number, outputPath: string, delimiter: string = ','): Promise<void> {
  return new Promise((resolve, reject) => {
    const headers = [
      'id',
      'first_name',
      'last_name',
      'email',
      'city',
      'state',
      'zip_code',
      'product',
      'price',
      'quantity',
      'total',
      'status',
      'order_date',
      'is_priority',
      'rating',
    ];

    const writeStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' });
    
    writeStream.on('error', (err) => {
      reject(err);
    });
    
    writeStream.on('finish', () => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const fileSize = fs.statSync(outputPath).size;
      const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);
      
      console.log(`\n✓ Generated CSV file:`);
      console.log(`  Path: ${outputPath}`);
      console.log(`  Records: ${numRecords.toLocaleString()}`);
      console.log(`  Size: ${fileSizeMB} MB`);
      console.log(`  Time: ${elapsed}s`);
      console.log(`  Delimiter: ${delimiter === '\t' ? 'TAB' : delimiter}`);
      
      resolve();
    });
    
    // Write header
    writeStream.write(headers.join(delimiter) + '\n');
    
    const batchSize = 1000;
    let batch: string[] = [];
    
    console.log(`Generating CSV file with ${numRecords.toLocaleString()} records...`);
    const startTime = Date.now();
    
    for (let i = 1; i <= numRecords; i++) {
      const record = generateRandomRecord(i);
      const line = record.map(escapeCSV).join(delimiter);
      batch.push(line);
      
      // Write batch when it reaches batchSize
      if (batch.length >= batchSize) {
        writeStream.write(batch.join('\n') + '\n');
        batch = [];
      }
      
      // Progress logging
      if (i % 100000 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`  Generated ${i.toLocaleString()} records (${elapsed}s)...`);
        
        // Manual GC if available
        if (global.gc) {
          global.gc();
        }
      }
    }
    
    // Write remaining batch
    if (batch.length > 0) {
      writeStream.write(batch.join('\n') + '\n');
    }
    
    writeStream.end();
  });
}

// Parse command line arguments
const args = process.argv.slice(2);
const numRecords = args[0] ? parseInt(args[0], 10) : 100000;
const format = args[1] || 'csv'; // 'csv' or 'tsv' or 'txt'
const delimiter = format === 'tsv' || format === 'txt' ? '\t' : ',';
const extension = format === 'tsv' ? 'tsv' : format === 'txt' ? 'txt' : 'csv';

if (isNaN(numRecords) || numRecords < 1) {
  console.error('Error: Invalid number of records');
  console.error('Usage: npm run generate-csv -- <num_records> [format]');
  console.error('  num_records: Number of records to generate (default: 100000)');
  console.error('  format: csv, tsv, or txt (default: csv)');
  console.error('\nExamples:');
  console.error('  npm run generate-csv -- 1000000        # 1M records, CSV format');
  console.error('  npm run generate-csv -- 5000000 tsv    # 5M records, TSV format');
  console.error('  npm run generate-csv -- 10000000 txt   # 10M records, TXT (tab-separated)');
  process.exit(1);
}

const outputPath = path.join(__dirname, `sample-${numRecords}.${extension}`);

// Run the generator
(async () => {
  try {
    await generateCSVFile(numRecords, outputPath, delimiter);
  } catch (error) {
    console.error('Error generating CSV file:', error);
    process.exit(1);
  }
})();
