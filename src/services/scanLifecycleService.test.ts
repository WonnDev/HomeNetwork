import { describe, expect, it, vi } from 'vitest'
import { createScanToken, runWithDeadline } from './scanLifecycleService'

describe('scan lifecycle', () => {
  it('invalidates a cancelled scan before a new scan starts', () => {
    const token = createScanToken()
    const first = token.start()
    token.cancel()
    const second = token.start()

    expect(token.isCurrent(first)).toBe(false)
    expect(token.isCurrent(second)).toBe(true)
  })

  it('settles work before the deadline and clears the timer', async () => {
    const timeout = vi.fn()
    await expect(runWithDeadline(Promise.resolve('done'), 100, timeout)).resolves.toBe('done')
    expect(timeout).not.toHaveBeenCalled()
  })

  it('rejects on deadline and invokes cancellation once', async () => {
    const timeout = vi.fn()
    await expect(runWithDeadline(new Promise(() => undefined), 1, timeout)).rejects.toThrow('Operation timed out.')
    expect(timeout).toHaveBeenCalledOnce()
  })
})