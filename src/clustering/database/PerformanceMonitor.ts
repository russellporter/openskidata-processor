import os from "os";

export interface PerformanceMetrics {
  operation: string;
  startTime: number;
  endTime: number;
  duration: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage?: NodeJS.CpuUsage;
  poolStats?: any;
  workerStats?: any;
}

export interface PerformanceSummary {
  totalOperations: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  totalMemoryPeak: number;
  operationCounts: Record<string, number>;
  operationAverages: Record<string, number>;
}

export class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private operationStart = new Map<string, {
    startTime: number;
    cpuUsage: NodeJS.CpuUsage;
  }>();
  private isEnabled: boolean;

  constructor(enabled: boolean = true) {
    this.isEnabled = enabled;
  }

  startOperation(operationId: string): void {
    if (!this.isEnabled) return;

    this.operationStart.set(operationId, {
      startTime: Date.now(),
      cpuUsage: process.cpuUsage(),
    });
  }

  endOperation(
    operationId: string, 
    operationType?: string,
    poolStats?: any,
    workerStats?: any
  ): PerformanceMetrics | null {
    if (!this.isEnabled) return null;

    const start = this.operationStart.get(operationId);
    if (!start) {
      console.warn(`No start recorded for operation ${operationId}`);
      return null;
    }

    const endTime = Date.now();
    const duration = endTime - start.startTime;
    const cpuUsage = process.cpuUsage(start.cpuUsage);
    const memoryUsage = process.memoryUsage();

    const metric: PerformanceMetrics = {
      operation: operationType || operationId,
      startTime: start.startTime,
      endTime,
      duration,
      memoryUsage,
      cpuUsage,
      poolStats,
      workerStats,
    };

    this.metrics.push(metric);
    this.operationStart.delete(operationId);

    return metric;
  }

  getMetrics(): PerformanceMetrics[] {
    return [...this.metrics];
  }

  getSummary(): PerformanceSummary {
    if (this.metrics.length === 0) {
      return {
        totalOperations: 0,
        averageDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        totalMemoryPeak: 0,
        operationCounts: {},
        operationAverages: {},
      };
    }

    const durations = this.metrics.map(m => m.duration);
    const memoryPeaks = this.metrics.map(m => m.memoryUsage.heapUsed);
    
    const operationCounts: Record<string, number> = {};
    const operationTotals: Record<string, number> = {};
    
    this.metrics.forEach(metric => {
      operationCounts[metric.operation] = (operationCounts[metric.operation] || 0) + 1;
      operationTotals[metric.operation] = (operationTotals[metric.operation] || 0) + metric.duration;
    });

    const operationAverages: Record<string, number> = {};
    Object.keys(operationCounts).forEach(op => {
      operationAverages[op] = operationTotals[op] / operationCounts[op];
    });

    return {
      totalOperations: this.metrics.length,
      averageDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      totalMemoryPeak: Math.max(...memoryPeaks),
      operationCounts,
      operationAverages,
    };
  }

  logSummary(): void {
    if (!this.isEnabled || this.metrics.length === 0) return;

    const summary = this.getSummary();
    const systemInfo = {
      cpus: os.cpus().length,
      totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024 * 100) / 100, // GB
      freeMemory: Math.round(os.freemem() / 1024 / 1024 / 1024 * 100) / 100, // GB
      platform: os.platform(),
      arch: os.arch(),
    };

    console.log("\n" + "=".repeat(80));
    console.log("📊 PERFORMANCE SUMMARY");
    console.log("=".repeat(80));
    console.log(`🖥️  System: ${systemInfo.cpus} CPUs, ${systemInfo.totalMemory}GB RAM (${systemInfo.freeMemory}GB free)`);
    console.log(`📈 Operations: ${summary.totalOperations} total`);
    console.log(`⏱️  Duration: avg ${Math.round(summary.averageDuration)}ms, min ${summary.minDuration}ms, max ${summary.maxDuration}ms`);
    console.log(`💾 Memory Peak: ${Math.round(summary.totalMemoryPeak / 1024 / 1024)}MB`);
    
    console.log("\n📊 Operation Breakdown:");
    Object.entries(summary.operationCounts)
      .sort(([,a], [,b]) => b - a)
      .forEach(([operation, count]) => {
        const avg = Math.round(summary.operationAverages[operation]);
        console.log(`   ${operation}: ${count} operations, ${avg}ms avg`);
      });

    // Performance recommendations
    console.log("\n💡 Recommendations:");
    const slowOperations = Object.entries(summary.operationAverages)
      .filter(([, avg]) => avg > 1000)
      .sort(([,a], [,b]) => b - a);
    
    if (slowOperations.length > 0) {
      console.log("   🐌 Slow operations detected:");
      slowOperations.forEach(([op, avg]) => {
        console.log(`      - ${op}: ${Math.round(avg)}ms (consider worker delegation)`);
      });
    }

    if (summary.totalMemoryPeak > 500 * 1024 * 1024) { // > 500MB
      console.log("   🧠 High memory usage detected (consider batch size tuning)");
    }

    const cpuIntensiveOps = Object.entries(summary.operationCounts)
      .filter(([op]) => op.includes('spatial') || op.includes('findNearby'))
      .reduce((sum, [, count]) => sum + count, 0);
    
    if (cpuIntensiveOps > systemInfo.cpus * 10) {
      console.log("   ⚡ Consider increasing worker pool size for spatial operations");
    }

    console.log("=".repeat(80) + "\n");
  }

  clearMetrics(): void {
    this.metrics = [];
    this.operationStart.clear();
  }

  enable(): void {
    this.isEnabled = true;
  }

  disable(): void {
    this.isEnabled = false;
  }

  // Helper method to wrap async operations with monitoring
  async measure<T>(
    operationType: string,
    operation: () => Promise<T>,
    getStats?: () => { poolStats?: any; workerStats?: any }
  ): Promise<T> {
    const operationId = `${operationType}_${Date.now()}_${Math.random()}`;
    this.startOperation(operationId);
    
    try {
      const result = await operation();
      const stats = getStats?.() || {};
      this.endOperation(operationId, operationType, stats.poolStats, stats.workerStats);
      return result;
    } catch (error) {
      this.endOperation(operationId, operationType);
      throw error;
    }
  }
}

// Global instance for easy access
export const performanceMonitor = new PerformanceMonitor(
  process.env.NODE_ENV !== 'test' && 
  process.env.JEST_WORKER_ID === undefined &&
  process.env.PERFORMANCE_MONITORING !== 'false'
);