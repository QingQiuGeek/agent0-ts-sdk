/**
 * XMTP-related errors (spec §3 error handling).
 */

export class XMTPReceiverNotRegisteredError extends Error {
  constructor(message = 'Receiver has no registered XMTP inbox') {
    super(message);
    this.name = 'XMTPReceiverNotRegisteredError';
    Object.setPrototypeOf(this, XMTPReceiverNotRegisteredError.prototype);
  }
}

export class XMTPMaxInstallationsError extends Error {
  constructor(message = 'Wallet has reached the maximum number of XMTP installations') {
    super(message);
    this.name = 'XMTPMaxInstallationsError';
    Object.setPrototypeOf(this, XMTPMaxInstallationsError.prototype);
  }
}

export class XMTPAlreadyConnectedError extends Error {
  constructor(message = 'XMTP inbox is already loaded') {
    super(message);
    this.name = 'XMTPAlreadyConnectedError';
    Object.setPrototypeOf(this, XMTPAlreadyConnectedError.prototype);
  }
}

export class XMTPWalletRequiredError extends Error {
  constructor(message = 'Wallet is required for XMTP but none is connected') {
    super(message);
    this.name = 'XMTPWalletRequiredError';
    Object.setPrototypeOf(this, XMTPWalletRequiredError.prototype);
  }
}

export class XMTPLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XMTPLoadError';
    Object.setPrototypeOf(this, XMTPLoadError.prototype);
  }
}
