#!/usr/bin/env node
import { Command } from 'commander';
import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { renderDocumentHtml } from '@gather/core';

const VERSION = '0.1.0-phase.0';
const program = new Command();

program
  .name('gather')
  .description('Gather, a local-first Markdown writing workspace.')
  .version(VERSION);

program
  .command('doctor')
  .description('检查 Node、平台与当前工作目录')
  .option('--json', '输出 JSON')
  .action((options: { json?: boolean }) => {
    const checked = {
      gather: VERSION,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      cwd: process.cwd(),
      nodeSupported: Number(process.versions.node.split('.')[0]) >= 22,
      ai: {
        localProvider: 'Ollama: configure GATHER_OLLAMA_URL when implemented',
        cloudProvider: 'Bring your own key; no bundled paid API',
      },
    };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(checked, null, 2)}\n`);
      return;
    }
    process.stdout.write(`Gather ${checked.gather}\n`);
    process.stdout.write(`Node ${checked.node} ${checked.nodeSupported ? '(supported)' : '(requires Node 22.13+)'}\n`);
    process.stdout.write(`Platform ${checked.platform}\n`);
    process.stdout.write(`Workspace ${checked.cwd}\n`);
    process.stdout.write(`AI local: ${checked.ai.localProvider}\n`);
    process.stdout.write(`AI cloud: ${checked.ai.cloudProvider}\n`);
  });

program
  .command('export')
  .argument('<file>', 'Markdown 文件')
  .description('把 Markdown 导出为 HTML；Phase 0 仅支持 HTML')
  .option('-f, --format <format>', '导出格式', 'html')
  .option('-o, --out <file>', '输出文件；省略则写入 stdout')
  .option('--json', '以 JSON 输出结果')
  .action(async (file: string, options: { format: string; out?: string; json?: boolean }) => {
    const format = options.format.toLowerCase();
    if (format !== 'html') {
      throw new Error(`Phase 0 只支持 html 导出，收到 ${format}。PDF/DOCX 会在后续阶段加入。`);
    }
    const source = await readFile(resolve(file), 'utf8');
    const title = file.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'Gather';
    const html = renderDocumentHtml(source, title);
    if (options.out) {
      const output = resolve(options.out);
      await writeFile(output, html, 'utf8');
      if (options.json) process.stdout.write(`${JSON.stringify({ output, bytes: Buffer.byteLength(html) })}\n`);
      else process.stdout.write(`已导出 ${output}\n`);
      return;
    }
    process.stdout.write(html);
  });

program
  .command('new')
  .argument('<file>', 'Markdown 文件路径')
  .description('创建一个新的 Markdown 文稿')
  .action(async (file: string) => {
    const target = resolve(file);
    await access(dirname(target));
    await writeFile(target, '# 未命名文稿\n\n从这里开始。\n', { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`已创建 ${target}\n`);
  });

program.parseAsync().catch(error => {
  process.stderr.write(`gather: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
