import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { createReadStream } from 'fs';
import * as path from 'path';
import * as fs from 'fs';

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(process.cwd(), 'storage');

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, STORAGE_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase() || '.csv';
    cb(null, 'data-upload-' + uniqueSuffix + ext);
  },
});

/**
 * File filter to accept CSV and TXT files
 */
const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
): void => {
  const allowedMimeTypes = [
    'text/csv',
    'text/plain',
    'application/csv',
    'application/vnd.ms-excel', // Some systems report CSV as this
  ];

  const allowedExtensions = ['.csv', '.txt'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only CSV and TXT files are allowed'));
  }
};

export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB limit
  },
}).single('datafile');

/**
 * Express middleware for handling file uploads
 */
export const uploadMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  upload(req, res, (err) => {
    if (err) {
      return next(err);
    }
    if (!req.file) {
      return next(new Error('No file uploaded'));
    }
    const filePath = req.file.path;
    (req as any).fileStream = createReadStream(filePath);
    (req as any).filePath = filePath;
    (req as any).originalName = req.file.originalname;
    next();
  });
};

/**
 * Get file extension from original filename
 */
export function getFileExtension(filename: string): string {
  return path.extname(filename).toLowerCase().replace('.', '');
}

/**
 * Determine if file is likely tab-separated based on extension
 * Note: For .txt files, content analysis is used instead since they can be either format
 */
export function isLikelyTabSeparated(filename: string): boolean {
  const ext = getFileExtension(filename);
  return ext === 'tab';
}
