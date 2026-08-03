import { Injectable } from '@nestjs/common';

@Injectable()
export class RequestTrackerService {
  private activeRequests = 0;
  private draining = false;

  start(): boolean {
    if (this.draining) {
      return false;
    }
    this.activeRequests += 1;
    return true;
  }

  finish(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
  }

  beginDrain(): void {
    this.draining = true;
  }

  isDraining(): boolean {
    return this.draining;
  }

  activeCount(): number {
    return this.activeRequests;
  }

  async waitForDrain(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.activeRequests > 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    return this.activeRequests === 0;
  }
}
