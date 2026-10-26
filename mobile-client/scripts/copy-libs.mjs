import { cpSync, mkdirSync } from 'node:fs';

// jsPDF must ship inside the app so PDFs can be created offline.
mkdirSync('www/lib', { recursive: true });
cpSync('node_modules/jspdf/dist/jspdf.umd.min.js', 'www/lib/jspdf.umd.min.js');
console.log('Copied jsPDF into www/lib');
