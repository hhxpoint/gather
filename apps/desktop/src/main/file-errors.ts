const FILE_ERROR_MESSAGES: Record<string, string> = {
  ENOSPC: '磁盘空间不足，Gather 未完成写入。原文件保持不变；请清理空间后重试或另存为。',
  EACCES: '没有权限访问目标文件或目录。Gather 未完成操作；请检查文件夹权限。',
  EPERM: '操作系统拒绝了访问（文件可能只读或被占用）。Gather 未完成操作。',
  EROFS: '目标位于只读文件系统，Gather 无法写入。请选择可写目录。',
  EBUSY: '文件正被其他程序占用，Gather 未完成写入。请关闭占用程序后重试。',
  ENOENT: '目标目录或文件不存在。Gather 未完成操作；请检查路径后重试。',
  EMFILE: '打开的文件过多，Gather 未完成操作。请关闭其他程序后重试。',
  ENFILE: '系统文件句柄不足，Gather 未完成操作。请稍后重试。',
  EIO: '磁盘读写发生 I/O 错误，Gather 未完成操作。原文件应保持不变。',
};

/** Map OS-level filesystem failures to actionable Chinese messages. */
export function fileErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && FILE_ERROR_MESSAGES[code]) return FILE_ERROR_MESSAGES[code];
    return error.message;
  }
  return '文件操作失败。';
}

export function toUserFacingFileError(error: unknown): Error {
  return new Error(fileErrorMessage(error));
}
