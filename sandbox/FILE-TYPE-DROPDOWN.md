# File Type Dropdown Feature

Added a file type selection dropdown with auto-detection and manual override capability.

## Changes Made

### 1. UI Updates (`src/public/index.html`)

**New Dropdown:**
```html
<select id="fileType" name="fileType">
  <option value="auto">Auto-detect</option>
  <option value="comma">CSV (Comma-separated)</option>
  <option value="tab">TSV/TXT (Tab-separated)</option>
</select>
```

**Detection Display:**
- Yellow info box appears after file selection
- Shows detected delimiter type
- Reminds user they can change it if needed

**Auto-Detection Logic:**
- Reads first 4KB of uploaded file
- Counts tabs vs commas in first 5 lines
- Automatically sets dropdown to detected format
- User can override before clicking "Parse File"

### 2. Server Updates (`src/server.ts`)

**Accepts User Preference:**
```typescript
const userDelimiter = req.body?.delimiter; // Optional user override

if (userDelimiter) {
  detectedFormat.delimiter = userDelimiter;
  console.log(`[Parse] Using user-specified delimiter`);
} else {
  console.log(`[Parse] Auto-detected delimiter`);
}
```

### 3. Client-Server Communication

**Form Data:**
```javascript
formData.append('datafile', fileInput.files[0]);
if (delimiterPreference !== 'auto') {
  formData.append('delimiter', delimiterPreference === 'comma' ? ',' : '\t');
}
```

## User Flow

1. **Select File**: User chooses a CSV/TXT file
2. **Auto-Detection**: System reads first 4KB and detects delimiter
3. **Display**: Detection result shown in yellow info box
4. **Dropdown Updates**: Dropdown automatically set to detected type
5. **Override Option**: User can manually change dropdown if detection is wrong
6. **Parse**: Clicking "Parse File" uses selected delimiter

## Example UI

```
┌─────────────────────────────────────────┐
│ Select Data File:                       │
│ [Choose File: sample.txt]               │
│ Supported formats: .csv and .txt files  │
│                                          │
│ ⚠️ Auto-detected: Tab-separated (TSV)   │
│    You can change it using dropdown     │
│                                          │
│ File Type/Delimiter:                    │
│ [TSV/TXT (Tab-separated) ▼]             │
│ Select the delimiter or use auto-detect │
│                                          │
│ [Parse File]                             │
└─────────────────────────────────────────┘
```

## Benefits

1. **Flexibility**: Users can override incorrect detection
2. **Transparency**: Shows what was detected before parsing
3. **Ease of Use**: Auto-detection works most of the time
4. **Manual Control**: Power users can force specific delimiter
5. **Visual Feedback**: Clear indication of detected format

## Testing

```bash
# Start server
npm run dev

# Visit http://localhost:3001
# Upload various files:
# - sample.csv (should detect comma)
# - sample.tsv (should detect tab)  
# - sample.txt (depends on content)
# - Try changing dropdown and parsing
```

## Backwards Compatibility

- If no delimiter is sent, server uses auto-detection (existing behavior)
- Existing API calls without delimiter parameter continue to work
- No breaking changes to server API
