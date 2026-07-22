class InProcessAlertCooldown {
  constructor(options = {}) {
    this.clock = options.clock || Date.now;
    this.entries = new Map();
  }

  evaluate(key, cooldownSeconds) {
    if (!/^[a-z0-9_:/.-]{1,256}$/i.test(key)) throw new Error('Invalid alert cooldown key.');
    const now = Number(this.clock());
    const durationMs = Math.max(1, Number(cooldownSeconds)) * 1000;
    const current = this.entries.get(key);
    if (current && now < current.expiresAt) {
      current.aggregateCount += 1;
      return { allowed: false, aggregateCount: current.aggregateCount, expiresAt: current.expiresAt };
    }
    const next = { expiresAt: now + durationMs, aggregateCount: 1 };
    this.entries.set(key, next);
    return { allowed: true, aggregateCount: next.aggregateCount, expiresAt: next.expiresAt };
  }

  reset(key) {
    if (key === undefined) { this.entries.clear(); return; }
    this.entries.delete(key);
  }

  size() { return this.entries.size; }
}

module.exports = { InProcessAlertCooldown };
