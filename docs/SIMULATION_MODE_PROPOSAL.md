# Training/Simulation Mode - Implementation Proposal

**Status:** Approved - Ready for Implementation  
**Date:** 2025-10-25  
**Priority:** Medium  

---

## Overview

Training/Simulation Mode allows operators to practice using OL-Grafik without connecting to live competitions. This feature enables:
- Testing graphics templates and workflows
- Training new operators
- Demonstrating the software without requiring a live event
- Development and testing without live data dependencies

---

## Architecture Decision

### ✅ **Recommended Approach: Simulation as a Data Source Type**

Implement simulation as a new `IDataSource` implementation that integrates seamlessly with existing architecture.

**Rationale:**
- Zero changes needed to DataStore, PlaybackEngine, or renderers
- Reuses existing event/WebSocket infrastructure
- Works with all existing templates automatically
- Follows OL-Grafik's pluggable data source pattern
- Can switch between live and simulation by changing data source

**Data Flow:**
```
SimulationDataSource (implements IDataSource)
    ↓ loads snapshot data from JSON
    ↓ simulates time progression
    ↓ emits data at intervals (like LiveResults polling)
    ↓
DataStore (existing - no changes needed!)
    ↓ emit('results:updated')
    ↓
PlaybackEngine (existing - auto-update works automatically!)
    ↓
Graphics Renderer (existing - no changes needed!)
```

---

## Data Format

### Simulation Snapshot (JSON)

```typescript
interface SimulationSnapshot {
  version: '1.0';
  competition: {
    id: number;
    name: string;
    date: string;
    organizer?: string;
  };
  classes: Array<{
    className: string;
    displayName?: string;
  }>;
  // Time-series data: results at different timestamps
  timeline: Array<{
    timestamp: number; // milliseconds from competition start
    results: {
      [className: string]: Result[]; // Results at this timestamp
    };
  }>;
  // Metadata
  duration: number; // Total competition duration in ms
  startTime: string; // ISO timestamp
}
```

### Playback State

```typescript
interface PlaybackState {
  mode: 'playing' | 'paused' | 'stopped';
  currentTime: number; // Current position in simulation (ms from start)
  speed: number; // Playback speed multiplier (0.5x, 1x, 2x, 5x, 10x)
  loop: boolean; // Whether to loop when reaching end
}
```

---

## Implementation Plan

### Phase 1: Core Functionality (MVP)

**1.1 Create SimulationDataSource Class**

**File:** `src/main/data/sources/SimulationDataSource.ts`

**Key Methods:**
```typescript
class SimulationDataSource implements IDataSource {
  private snapshot: SimulationSnapshot | null = null;
  private playbackState: PlaybackState;
  private playbackTimer: NodeJS.Timeout | null = null;
  private startRealTime: number = 0;
  
  // IDataSource interface
  async initialize(): Promise<void>;
  async destroy(): Promise<void>;
  async getCompetitions(): Promise<Competition[]>;
  async getClasses(competitionId: number): Promise<Class[]>;
  async getResults(competitionId: number, className: string): Promise<Result[]>;
  startPolling(competitionId: number, className: string, interval: number): void;
  stopPolling(competitionId: number, className: string): void;
  supportsRealTime(): boolean; // Returns true
  
  // Simulation-specific methods
  async loadSnapshot(snapshotPath: string): Promise<void>;
  play(): void;
  pause(): void;
  stop(): void;
  setSpeed(speed: number): void;
  jumpTo(time: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlaybackState(): PlaybackState;
  
  // Internal methods
  private tick(): void; // Called on interval to advance simulation
  private getResultsAtTime(className: string, time: number): Result[];
}
```

**Core Logic - Time Progression:**
```typescript
private tick(): void {
  if (this.playbackState.mode !== 'playing') return;
  
  // Calculate elapsed time since playback started
  const now = Date.now();
  const elapsed = (now - this.startRealTime) * this.playbackState.speed;
  this.playbackState.currentTime += elapsed;
  this.startRealTime = now;
  
  // Check if reached end
  if (this.playbackState.currentTime >= this.snapshot!.duration) {
    if (this.playbackState.loop) {
      this.playbackState.currentTime = 0;
    } else {
      this.pause();
      return;
    }
  }
  
  // Emit updated results for all classes being polled
  for (const [key, pollConfig] of this.pollingConfigs) {
    const { competitionId, className } = pollConfig;
    const results = this.getResultsAtTime(className, this.playbackState.currentTime);
    
    // Trigger callback (same pattern as LiveResultsDataSource)
    pollConfig.onUpdate(results);
  }
}
```

**1.2 Update Type Definitions**

**File:** `src/shared/types/dataSource.ts`

```typescript
export type DataSourceType = 'liveresults' | 'manual' | 'csv' | 'mysql' | 'simulation' | 'custom';

export interface SimulationDataSourceConfig extends DataSourceConfig {
  type: 'simulation';
  config: {
    snapshotPath: string; // Path to snapshot JSON file
    autoPlay?: boolean; // Start playing automatically
    defaultSpeed?: number; // Default playback speed
    loop?: boolean; // Loop when reaching end
  };
}
```

**1.3 Register Simulation Data Source**

**File:** `src/main/data/sources/index.ts`

```typescript
import { createSimulationDataSource } from './SimulationDataSource';

registry.register({
  type: 'simulation',
  factory: createSimulationDataSource,
  displayName: 'Simulation/Training Mode',
  description: 'Replay historical competition data for training and testing'
});
```

**1.4 Create Default Training Dataset**

- Convert `templates/SMGraphics-example/backup.sql` to simulation snapshot JSON
- Store in `dataroot/simulations/default-training.json`
- Include realistic time progression (sample data at 30-second intervals)

---

### Phase 2: UI Integration

**2.1 Training Mode Banner**

**Component:** `src/renderer/control/components/TrainingModeBanner.tsx`

```tsx
// Orange/yellow banner across top of Production View
// Text: "🎓 TRAINING MODE ACTIVE - Not connected to live data"
// Dismissible but reappears on page reload
```

**2.2 Playback Controls Panel**

**Component:** `src/renderer/control/components/SimulationPlaybackControls.tsx`

**UI Layout:**
```
┌─────────────────────────────────────────────────┐
│ 🎬 Simulation Playback Controls                │
├─────────────────────────────────────────────────┤
│ Dataset: [Default Training Data ▼]             │
│                                                 │
│ ⏮ ⏸ ▶ ⏭  Speed: [1x ▼]  Loop: [✓]           │
│                                                 │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ 00:15:30 / 02:30:00                            │
│                                                 │
│ Jump to: [30 min ▼] [Go]                       │
└─────────────────────────────────────────────────┘
```

**Controls:**
- Play/Pause: Start/stop simulation
- Stop: Reset to beginning
- Speed: Dropdown (0.5x, 1x, 2x, 5x, 10x, 20x)
- Loop: Checkbox to loop when reaching end
- Progress Bar: Draggable to jump to specific time
- Time Display: Current time / Total duration
- Jump To: Quick jump presets (30 min, 1 hour, Finish)

**2.3 Data Source Manager Updates**

**File:** `src/renderer/control/components/DataSourceManager.tsx`

Add simulation configuration form with:
- Snapshot file selector (file input, accepts .json)
- Default speed dropdown
- Loop checkbox
- Preview of snapshot metadata (competition name, duration, classes)

**2.4 IPC Handlers**

**File:** `src/main/ipc/simulationHandlers.ts`

```typescript
export function registerSimulationHandlers(): void {
  ipcMain.handle('simulation:play', async (_event, dataSourceId: string) => { ... });
  ipcMain.handle('simulation:pause', async (_event, dataSourceId: string) => { ... });
  ipcMain.handle('simulation:stop', async (_event, dataSourceId: string) => { ... });
  ipcMain.handle('simulation:setSpeed', async (_event, dataSourceId: string, speed: number) => { ... });
  ipcMain.handle('simulation:jumpTo', async (_event, dataSourceId: string, time: number) => { ... });
  ipcMain.handle('simulation:getState', async (_event, dataSourceId: string) => { ... });
}
```

Register in `src/main/ipc/index.ts`.

---

### Phase 3: Snapshot Creation Tools (Optional)

**File:** `src/main/data/SnapshotCreator.ts`

```typescript
class SnapshotCreator {
  /**
   * Create simulation snapshot from MySQL database
   * Samples data at regular intervals to create timeline
   */
  async createFromMySQL(
    mysqlConfig: MySQLDataSourceConfig,
    competitionId: number,
    options: {
      sampleInterval?: number; // Default: 30000ms (30s)
      startTime?: Date;
      duration?: number; // Auto-detect if not provided
    }
  ): Promise<SimulationSnapshot>;
  
  /**
   * Create snapshot from LiveResults API
   */
  async createFromLiveResults(
    competitionId: number,
    className: string
  ): Promise<SimulationSnapshot>;
  
  /**
   * Save snapshot to JSON file
   */
  async saveSnapshot(snapshot: SimulationSnapshot, path: string): Promise<void>;
}
```

---

## Data Storage Strategy

### Primary: JSON Files
- **Location:** `{dataroot}/simulations/*.json`
- **Benefits:** Easy to share, version control friendly, human-readable, fast to load
- **Use Cases:** Default training datasets, exported snapshots, quick testing

### Secondary: MySQL Database
- **Use Case:** Create snapshots from existing MySQL databases
- **Workflow:** MySQL Database → SnapshotCreator → JSON File → SimulationDataSource

---

## UI/UX Integration

### Production View Layout
```
┌─────────────────────────────────────────────────────────────┐
│ 🎓 TRAINING MODE ACTIVE - Not connected to live data       │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Production View                                             │
│ ┌─────────────────┐ ┌─────────────────┐ ┌────────────────┐│
│ │ Rundown Panel   │ │ Template Panel  │ │ Preview Panel  ││
│ │                 │ │                 │ │                ││
│ └─────────────────┘ └─────────────────┘ └────────────────┘│
│ ┌───────────────────────────────────────────────────────┐  │
│ │ 🎬 Simulation Playback Controls [Collapse ▲]         │  │
│ │ ⏮ ⏸ ▶ ⏭  Speed: 1x  ━━━━━━━━━━━━━ 00:15:30/02:30:00│  │
│ └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Keyboard Shortcuts
- **Space:** Play/Pause
- **← →:** Jump back/forward 30 seconds
- **Shift + ← →:** Jump back/forward 5 minutes
- **Home:** Jump to start
- **End:** Jump to end

---

## Implementation Checklist

### Phase 1: Core Functionality (MVP)
- [ ] Create `SimulationDataSource` class implementing `IDataSource`
- [ ] Implement playback state management (play, pause, stop, speed)
- [ ] Implement time-based data progression with `tick()` method
- [ ] Add 'simulation' to `DataSourceType` union
- [ ] Create `SimulationDataSourceConfig` interface
- [ ] Register simulation data source in registry
- [ ] Create default training snapshot from SMGraphics backup.sql
- [ ] Test simulation data source with existing templates

### Phase 2: UI Integration
- [ ] Create `TrainingModeBanner` component
- [ ] Create `SimulationPlaybackControls` component
- [ ] Add simulation config form to `DataSourceManager`
- [ ] Create IPC handlers for playback controls
- [ ] Register IPC handlers in main process
- [ ] Add keyboard shortcuts for playback controls
- [ ] Test UI integration with simulation data source

### Phase 3: Snapshot Tools (Optional - Future)
- [ ] Create `SnapshotCreator` class
- [ ] Implement `createFromMySQL` method
- [ ] Implement `createFromLiveResults` method
- [ ] Add UI for creating snapshots
- [ ] Add UI for managing snapshot library

### Phase 4: Advanced Features (Future)
- [ ] Live recording functionality
- [ ] Snapshot editing/merging
- [ ] Event injection (manually trigger events during simulation)
- [ ] Scenario builder (create custom competition scenarios)

---

## Benefits

### For Training
- ✅ New operators can practice without affecting live broadcasts
- ✅ Repeatable scenarios for consistent training
- ✅ Safe environment to learn keyboard shortcuts and workflows
- ✅ Can practice error recovery (MP, DNF scenarios)

### For Testing
- ✅ Template designers can test with realistic data progression
- ✅ Developers can test features without live competition data
- ✅ QA can create reproducible test scenarios
- ✅ Performance testing with known data patterns

### For Demonstrations
- ✅ Show potential clients how the system works
- ✅ Demo at trade shows without internet connection
- ✅ Create impressive demo scenarios with dramatic finishes
- ✅ Controlled environment for presentations

### For Development
- ✅ No dependency on live events for development
- ✅ Faster iteration cycles
- ✅ Reproducible bugs and edge cases
- ✅ Offline development capability

---

## Technical Considerations

### Performance
- ✅ Simulation runs in main process (same as other data sources)
- ✅ No impact on graphics rendering performance
- ✅ Debounced WebSocket updates (existing mechanism)
- ✅ Can switch to live mode instantly (just change data source)

### Data Integrity
- ✅ Simulation data is read-only (can't corrupt live data)
- ✅ Clear visual indicators prevent confusion
- ✅ Separate data source type prevents accidental mixing

### Compatibility
- ✅ Works with all existing OGRAF templates (no template changes needed)
- ✅ Uses existing DataStore event system
- ✅ Compatible with auto-update functionality
- ✅ Works with existing WebSocket infrastructure

### Security
- ✅ Snapshot files are validated before loading
- ✅ No network access required (offline capability)
- ✅ Sandboxed from live data sources

---

## Files to Create/Modify

### New Files
1. `src/main/data/sources/SimulationDataSource.ts` - Core simulation data source
2. `src/main/ipc/simulationHandlers.ts` - IPC handlers for playback controls
3. `src/renderer/control/components/TrainingModeBanner.tsx` - Visual indicator
4. `src/renderer/control/components/SimulationPlaybackControls.tsx` - Playback UI
5. `dataroot/simulations/default-training.json` - Default training dataset
6. `src/main/data/SnapshotCreator.ts` - Snapshot creation tools (Phase 3)

### Modified Files
1. `src/shared/types/dataSource.ts` - Add simulation type and config interface
2. `src/main/data/sources/index.ts` - Register simulation data source
3. `src/renderer/control/components/DataSourceManager.tsx` - Add simulation config form
4. `src/main/ipc/index.ts` - Register simulation IPC handlers
5. `src/renderer/control/views/ProductionView.tsx` - Add banner and playback controls

---

## Testing Strategy

### Unit Tests
- SimulationDataSource playback logic
- Time progression and interpolation
- Playback state management
- Snapshot loading and validation

### Integration Tests
- Data flow from SimulationDataSource → DataStore → PlaybackEngine
- WebSocket broadcasting of simulation updates
- Auto-update functionality with simulation data
- Switching between live and simulation modes

### Manual Testing
- Load default training dataset
- Test playback controls (play, pause, stop, speed, jump)
- Verify graphics update correctly during simulation
- Test keyboard shortcuts
- Verify training mode banner visibility
- Test with multiple templates and classes

---

## Future Enhancements

1. **Live Recording:** Record live competitions to create simulation datasets
2. **Snapshot Editor:** GUI tool to edit/merge snapshots
3. **Event Injection:** Manually trigger specific events during simulation
4. **Scenario Builder:** Create custom competition scenarios from scratch
5. **Multi-Class Simulation:** Simulate multiple classes simultaneously
6. **Realistic Variations:** Add randomness to simulate real-world variations
7. **Snapshot Library:** Built-in library of training scenarios
8. **Cloud Sharing:** Share snapshots with other OL-Grafik users

---

## Notes

- Follow OL-Grafik standards: logger usage, error handling, IPC response format
- Don't break existing data source functionality
- Make it clear when system is in simulation mode to prevent confusion
- Consider performance - simulation shouldn't impact ability to switch to live mode quickly
- Simulation mode is completely independent of live data sources
- No changes needed to existing templates or graphics renderers


