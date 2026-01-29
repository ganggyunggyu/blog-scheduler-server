export type ProgressOutcome = 'ok' | 'fail' | 'skip';

export interface ProgressOptions {
  label?: string;
  total: number;
  width?: number;
  showCounts?: boolean;
  showStatus?: boolean;
}

export class ProgressBar {
  private current = 0;
  private ok = 0;
  private fail = 0;
  private lastStep: string | null = null;
  private readonly label: string;
  private readonly total: number;
  private readonly width: number;
  private readonly showCounts: boolean;
  private readonly showStatus: boolean;

  constructor(options: ProgressOptions) {
    this.label = options.label?.trim() ?? '';
    this.total = Math.max(0, options.total);
    this.width = Math.max(8, options.width ?? 20);
    this.showCounts = options.showCounts ?? true;
    this.showStatus = options.showStatus ?? false;
  }

  start(step?: string): string {
    if (step) {
      this.lastStep = step;
    }
    return this.render();
  }

  step(step: string): string {
    return this.tick(undefined, step);
  }

  tick(outcome?: ProgressOutcome, step?: string): string {
    if (this.total > 0) {
      this.current = Math.min(this.current + 1, this.total);
    }

    if (outcome === 'ok') this.ok += 1;
    if (outcome === 'fail') this.fail += 1;

    if (step) {
      this.lastStep = step;
    }

    return this.render();
  }

  done(step?: string): string {
    if (this.total > 0) {
      this.current = this.total;
    }

    if (step) {
      this.lastStep = step;
    }

    return this.render();
  }

  private render(): string {
    const ratio = this.total > 0 ? this.current / this.total : 1;
    const filled = Math.round(ratio * this.width);
    const bar = `${'='.repeat(filled)}${'-'.repeat(this.width - filled)}`;
    const label = this.label ? `${this.label} ` : '';

    let message = `${label}[${bar}]`;

    if (this.showCounts) {
      message += ` ${this.current}/${this.total}`;
    }

    if (this.showStatus) {
      message += ` ok=${this.ok} fail=${this.fail}`;
    }

    if (this.lastStep) {
      message += ` - ${this.lastStep}`;
    }

    return message;
  }
}
