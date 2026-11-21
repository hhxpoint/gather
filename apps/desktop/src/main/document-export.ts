import { app, BrowserWindow, dialog } from 'electron';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import type {
  DocumentExportRequest,
  DocumentExportResult,
  ExportFormat,
} from '../shared/files';
import { replaceFileAtomically } from './atomic-write';
import { buildExportDocument, sanitizeExportStem } from './export-html';

const FORMAT_LABELS: Record<ExportFormat, string> = {
  pdf: 'PDF',
  html: 'HTML',
};

const FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  pdf: '.pdf',
  html: '.html',
};

function ensureExtension(filePath: string, format: ExportFormat): string {
  return extname(filePath) ? filePath : `${filePath}${FORMAT_EXTENSIONS[format]}`;
}

async function renderPdf(html: string): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'gather-export-'));
  const documentPath = join(directory, 'document.html');
  let window: BrowserWindow | null = null;
  try {
    await writeFile(documentPath, html, 'utf8');
    window = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await window.loadFile(documentPath);
    // Local images are embedded as data URIs. This short settle window gives
    // Chromium time to lay out fonts and table pages before printing.
    await new Promise(resolve => setTimeout(resolve, 250));
    const pdf = await window.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      preferCSSPageSize: true,
      generateTaggedPDF: true,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    if (pdf.length < 5 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('PDF 生成结果无效，Gather 未写入文件。');
    }
    return pdf;
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function exportDocument(
  parent: BrowserWindow,
  request: DocumentExportRequest,
  sourcePath: string | null,
): Promise<DocumentExportResult> {
  const stem = sanitizeExportStem(request.suggestedName);
  const defaultDirectory = sourcePath ? dirname(sourcePath) : app.getPath('documents');
  const result = await dialog.showSaveDialog(parent, {
    title: `导出 ${FORMAT_LABELS[request.format]}`,
    defaultPath: join(defaultDirectory, `${stem}${FORMAT_EXTENSIONS[request.format]}`),
    filters: [{
      name: FORMAT_LABELS[request.format],
      extensions: [request.format === 'pdf' ? 'pdf' : 'html'],
    }],
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true, warnings: [] };
  }

  const target = ensureExtension(result.filePath, request.format);
  const document = await buildExportDocument(
    request.markdown,
    stem,
    sourcePath ? dirname(sourcePath) : null,
  );
  const bytes = request.format === 'pdf'
    ? await renderPdf(document.html)
    : Buffer.from(document.html, 'utf8');
  await replaceFileAtomically(target, bytes);
  return {
    canceled: false,
    path: target,
    bytes: bytes.byteLength,
    warnings: document.warnings,
  };
}
