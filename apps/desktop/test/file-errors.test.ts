import { describe, expect, it } from 'vitest';
import { fileErrorMessage, toUserFacingFileError } from '../src/main/file-errors';
import { errorMessage } from '../src/shared/errors';

function errno(code: string, message = code): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

describe('filesystem error messages', () => {
  it.each([
    ['ENOSPC', /磁盘空间不足/],
    ['EACCES', /没有权限/],
    ['EPERM', /拒绝/],
    ['EROFS', /只读文件系统/],
    ['EBUSY', /占用/],
    ['ENOENT', /不存在/],
    ['EIO', /I\/O/],
  ] as const)('maps %s to an actionable message', (code, pattern) => {
    expect(fileErrorMessage(errno(code))).toMatch(pattern);
  });

  it('preserves application-level messages and handles unknown values', () => {
    expect(fileErrorMessage(new Error('文件版本信息无效。'))).toBe('文件版本信息无效。');
    expect(fileErrorMessage('not an error')).toBe('文件操作失败。');
    expect(toUserFacingFileError(errno('ENOSPC'))).toBeInstanceOf(Error);
  });
});

describe('ipc error display', () => {
  it('strips the Electron invoke prefix', () => {
    expect(errorMessage(
      new Error("Error invoking remote method 'file:save': Error: 磁盘空间不足，Gather 未完成写入。"),
    )).toBe('磁盘空间不足，Gather 未完成写入。');
  });

  it('keeps plain messages and falls back for non-errors', () => {
    expect(errorMessage(new Error('没有权限访问目标文件。'))).toBe('没有权限访问目标文件。');
    expect(errorMessage(new Error('   '), '操作失败')).toBe('操作失败');
    expect(errorMessage(null, '打开失败')).toBe('打开失败');
  });
});
