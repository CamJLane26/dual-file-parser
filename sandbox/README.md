# Sample Data Generator

This directory contains a script to generate sample CSV and tab-separated text files for testing the parser.

## Usage

Generate sample files with the following command:

```bash
npm run generate-csv -- <num_records> [format]
```

### Parameters

- `num_records`: Number of records to generate (required)
- `format`: File format - `csv` or `txt` (optional, default: `csv`)
  - `csv` - Comma-separated values with `.csv` extension
  - `txt` - Tab-separated values with `.txt` extension

### Examples

```bash
# Generate 1,000 records in CSV format
npm run generate-csv -- 1000

# Generate 10,000 records in CSV format
npm run generate-csv -- 10000 csv

# Generate 5,000 records in tab-separated TXT format
npm run generate-csv -- 5000 txt

# Generate 1 million records in CSV format
npm run generate-csv -- 1000000

# Generate 10 million records in tab-separated TXT format
npm run generate-csv -- 10000000 txt
```

## Generated Fields

Each record contains the following fields:

- `id` - Sequential numeric ID
- `first_name` - Random first name
- `last_name` - Random last name
- `email` - Generated email address
- `city` - Random US city
- `state` - US state code
- `zip_code` - 5-digit zip code
- `product` - Product name
- `price` - Price (decimal)
- `quantity` - Quantity (integer)
- `total` - Total amount (decimal)
- `status` - Order status (active, inactive, pending, completed, cancelled)
- `order_date` - Date in YYYY-MM-DD format
- `is_priority` - Boolean (true/false)
- `rating` - Rating (0.0-5.0)

## Output

Generated files are saved in this directory with the naming pattern:
- `sample-{num_records}.csv` for CSV files
- `sample-{num_records}.txt` for tab-separated TXT files

## Performance Notes

- The generator uses batching for memory efficiency
- Progress is logged every 100,000 records
- Garbage collection is triggered periodically for large files
- A 1 million record file takes approximately 5-10 seconds to generate
