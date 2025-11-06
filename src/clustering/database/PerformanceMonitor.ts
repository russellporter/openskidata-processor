interface PerformanceMetrics {
  operation: string;
  operationId: string;
  startTime: number;
  endTime: number;
  duration: number;
  parentOperation?: string;
  phase?: string;
}

export class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private operationStart = new Map<
    string,
    {
      startTime: number;
      parentOperation?: string;
      phase?: string;
    }
  >();
  private isEnabled: boolean;
  private contextStack: string[] = [];

  constructor(enabled: boolean = true) {
    this.isEnabled = enabled;
  }

  getMetrics(): PerformanceMetrics[] {
    return [...this.metrics];
  }

  logTimeline(): void {
    if (!this.isEnabled || this.metrics.length === 0) return;

    console.log("\n" + "=".repeat(80));
    console.log("PROCESSING TIMELINE");
    console.log("=".repeat(80));

    // Group metrics by phase
    const phaseMetrics = new Map<string, PerformanceMetrics[]>();

    for (const metric of this.metrics) {
      if (metric.phase) {
        if (!phaseMetrics.has(metric.phase)) {
          phaseMetrics.set(metric.phase, []);
        }
        phaseMetrics.get(metric.phase)!.push(metric);
      }
    }

    // Sort phases by first operation start time
    // Note: Using reduce() instead of Math.min(...array) to avoid stack overflow with large datasets
    const sortedPhases = Array.from(phaseMetrics.entries()).sort(
      ([, a], [, b]) => {
        const minA = a.reduce((min, m) => Math.min(min, m.startTime), Infinity);
        const minB = b.reduce((min, m) => Math.min(min, m.startTime), Infinity);
        return minA - minB;
      },
    );

    // Display each phase
    for (const [phaseName, metrics] of sortedPhases) {
      // Using reduce() instead of spread operator to avoid stack overflow with large metric arrays
      const phaseStartTime = metrics.reduce((min, m) => Math.min(min, m.startTime), Infinity);
      const phaseEndTime = metrics.reduce((max, m) => Math.max(max, m.endTime), -Infinity);
      const phaseDuration = phaseEndTime - phaseStartTime;

      console.log(`${phaseName} (${this.formatDuration(phaseDuration)})`);

      // Build parent-child map once upfront to avoid repeated filtering
      const childrenMap = new Map<string, PerformanceMetrics[]>();
      for (const metric of metrics) {
        if (metric.parentOperation) {
          if (!childrenMap.has(metric.parentOperation)) {
            childrenMap.set(metric.parentOperation, []);
          }
          childrenMap.get(metric.parentOperation)!.push(metric);
        }
      }

      // Sort children by start time once
      for (const children of childrenMap.values()) {
        children.sort((a, b) => a.startTime - b.startTime);
      }

      // Find root operations for this phase
      // If there's a single operation with the same name as the phase, show its children directly
      const phaseWrapperOperations = metrics.filter(
        (m) => m.operation === phaseName,
      );

      let rootOperations: PerformanceMetrics[];
      if (phaseWrapperOperations.length === 1) {
        // If there's a single phase wrapper, show its children directly
        const wrapperOperation = phaseWrapperOperations[0];
        rootOperations = childrenMap.get(wrapperOperation.operationId) || [];
      } else {
        // Otherwise, show all root operations (operations without parents in this phase)
        rootOperations = metrics
          .filter(
            (m) =>
              !m.parentOperation ||
              !metrics.some((pm) => pm.operationId === m.parentOperation),
          )
          .sort((a, b) => a.startTime - b.startTime);
      }

      const displayOperation = (
        rootMetric: PerformanceMetrics,
        rootPrefix: string,
        rootIsLast: boolean,
        childrenMap: Map<string, PerformanceMetrics[]>,
      ) => {
        // Use iterative approach with a stack to avoid call stack overflow
        interface StackItem {
          metric: PerformanceMetrics;
          prefix: string;
          isLast: boolean;
        }

        const stack: StackItem[] = [
          { metric: rootMetric, prefix: rootPrefix, isLast: rootIsLast },
        ];

        while (stack.length > 0) {
          const { metric, prefix, isLast } = stack.pop()!;

          const slowWarning = metric.duration > 30000 ? " ⚠️" : "";
          console.log(
            `${prefix} ${metric.operation} (${this.formatDuration(metric.duration)})${slowWarning}`,
          );

          // Get child operations from pre-built map
          const childOps = childrenMap.get(metric.operationId) || [];

          // Push children onto stack in reverse order so they're processed in correct order
          for (let childIndex = childOps.length - 1; childIndex >= 0; childIndex--) {
            const childMetric = childOps[childIndex];
            const isLastChild = childIndex === childOps.length - 1;
            const childPrefix = isLast ? "   " : "│  ";
            const childTreePrefix = isLastChild ? "└─" : "├─";

            stack.push({
              metric: childMetric,
              prefix: `${childPrefix}${childTreePrefix}`,
              isLast: isLastChild,
            });
          }
        }
      };

      rootOperations.forEach((metric, index) => {
        const isLast = index === rootOperations.length - 1;
        const prefix = isLast ? "└─" : "├─";
        displayOperation(metric, prefix, isLast, childrenMap);
      });

      console.log();
    }

    // Group and display operations that don't belong to any phase
    const otherOperations = this.metrics.filter((m) => !m.phase);
    if (otherOperations.length > 0) {
      console.log("Other Operations:");

      // Group by operation name
      const operationGroups = new Map<string, PerformanceMetrics[]>();
      otherOperations.forEach((metric) => {
        if (!operationGroups.has(metric.operation)) {
          operationGroups.set(metric.operation, []);
        }
        operationGroups.get(metric.operation)!.push(metric);
      });

      // Display grouped operations
      Array.from(operationGroups.entries())
        .sort(([, a], [, b]) => b.length - a.length) // Sort by count descending
        .forEach(([operationName, operations]) => {
          const count = operations.length;
          const avgDuration =
            operations.reduce((sum, op) => sum + op.duration, 0) / count;
          const slowWarning = avgDuration > 1000 ? " ⚠️" : "";

          if (count === 1) {
            console.log(
              `├─ ${operationName} (${Math.round(avgDuration)}ms)${slowWarning}`,
            );
          } else {
            console.log(
              `├─ ${operationName}: ${count} operations, ${Math.round(avgDuration)}ms avg${slowWarning}`,
            );
          }
        });
      console.log();
    }

    // Using reduce() instead of spread operator to avoid stack overflow with large metric arrays
    const totalDuration =
      this.metrics.length > 0
        ? this.metrics.reduce((max, m) => Math.max(max, m.endTime), -Infinity) -
          this.metrics.reduce((min, m) => Math.min(min, m.startTime), Infinity)
        : 0;

    console.log(`Total Processing Time: ${this.formatDuration(totalDuration)}`);
    console.log("=".repeat(80) + "\n");
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (ms < 60000) {
      return `${Math.round((ms / 1000) * 10) / 10}s`;
    } else {
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.round((ms % 60000) / 1000);
      return `${minutes}m ${seconds}s`;
    }
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
    getStats?: () => any,
  ): Promise<T> {
    const operationId = `${operationType}_${Date.now()}_${Math.random()}`;
    this.startOperation(operationId);

    try {
      const result = await operation();
      this.endOperation(operationId, operationType);
      return result;
    } catch (error) {
      this.endOperation(operationId, operationType);
      throw error;
    }
  }

  // New cleaner API methods

  /**
   * Execute an operation within a phase context
   * @param phaseName - Name of the phase (e.g., "Phase 2: GeoJSON Preparation")
   * @param operation - The operation to execute
   */
  async withPhase<T>(
    phaseName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const phaseId = `phase_${Date.now()}_${Math.random()}`;
    this.startOperation(phaseId, undefined, phaseName);
    this.contextStack.push(phaseId);

    try {
      const result = await operation();
      this.endOperation(phaseId, phaseName);
      return result;
    } catch (error) {
      this.endOperation(phaseId, phaseName);
      throw error;
    } finally {
      this.contextStack.pop();
    }
  }

  /**
   * Execute an operation within the current context
   * @param operationName - Name of the operation
   * @param operation - The operation to execute
   */
  async withOperation<T>(
    operationName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    console.log(operationName);
    const operationId = `${operationName}_${Date.now()}_${Math.random()}`;
    const parentOperation = this.contextStack[this.contextStack.length - 1];
    const phase = parentOperation
      ? this.operationStart.get(parentOperation)?.phase
      : undefined;

    this.startOperation(operationId, parentOperation, phase);
    this.contextStack.push(operationId);

    try {
      const result = await operation();
      this.endOperation(operationId, operationName);
      return result;
    } catch (error) {
      this.endOperation(operationId, operationName);
      throw error;
    } finally {
      this.contextStack.pop();
    }
  }

  /**
   * Execute a synchronous operation within the current context
   * @param operationName - Name of the operation
   * @param operation - The operation to execute
   */
  withOperationSync<T>(operationName: string, operation: () => T): T {
    const operationId = `${operationName}_${Date.now()}_${Math.random()}`;
    const parentOperation = this.contextStack[this.contextStack.length - 1];
    const phase = parentOperation
      ? this.operationStart.get(parentOperation)?.phase
      : undefined;

    this.startOperation(operationId, parentOperation, phase);
    this.contextStack.push(operationId);

    try {
      const result = operation();
      this.endOperation(operationId, operationName);
      return result;
    } catch (error) {
      this.endOperation(operationId, operationName);
      throw error;
    } finally {
      this.contextStack.pop();
    }
  }

  private startOperation(
    operationId: string,
    parentOperation?: string,
    phase?: string,
  ): void {
    if (!this.isEnabled) return;

    this.operationStart.set(operationId, {
      startTime: Date.now(),
      parentOperation,
      phase,
    });
  }

  private endOperation(
    operationId: string,
    operationType?: string,
  ): PerformanceMetrics | null {
    if (!this.isEnabled) return null;

    const start = this.operationStart.get(operationId);
    if (!start) {
      console.warn(`No start recorded for operation ${operationId}`);
      return null;
    }

    const endTime = Date.now();
    const duration = endTime - start.startTime;

    const metric: PerformanceMetrics = {
      operation: operationType || operationId,
      operationId,
      startTime: start.startTime,
      endTime,
      duration,
      parentOperation: start.parentOperation,
      phase: start.phase,
    };

    this.metrics.push(metric);
    this.operationStart.delete(operationId);

    return metric;
  }
}

export const performanceMonitor = new PerformanceMonitor(
  process.env.NODE_ENV !== "test" &&
    process.env.JEST_WORKER_ID === undefined &&
    process.env.PERFORMANCE_MONITORING !== "false",
);
