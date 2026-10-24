export interface ScanToken {
  start(): number
  cancel(): number
  isCurrent(id: number): boolean
}

export function createScanToken(): ScanToken {
  let currentId = 0
  return {
    start: () => ++currentId,
    cancel: () => ++currentId,
    isCurrent: (id) => id === currentId,
  }
}

export async function runWithDeadline<T>(work: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout()
      reject(new Error('Operation timed out.'))
    }, timeoutMs)
  })

  try {
    return await Promise.race([work, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
