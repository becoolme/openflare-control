/**
 * Portable error type for the cell plane.
 *
 * The vibeploy routes translate it to the platform HTTP envelope; the OSS
 * plane maps it directly. Keeping the status/errorCode fields on the error
 * means callers and tests can assert the same shape on both sides.
 */
export class VrtControlError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errorCode?: string
  ) {
    super(message)
    this.name = 'VrtControlError'
  }
}
