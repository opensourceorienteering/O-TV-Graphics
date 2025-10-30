# Data Source Plugin API

**Version:** 1.0.0  
**Last Updated:** 2025-10-20

## Overview

OL-Grafik supports pluggable data sources through the `IDataSource` interface. This allows you to integrate custom data sources beyond the built-in LiveResults integration, such as:

- Manual data entry systems
- CSV file imports
- Custom REST APIs
- Database connections
- Third-party timing systems

## Architecture

The data source architecture consists of three main components:

1. **IDataSource Interface** - The contract that all data sources must implement
2. **DataSourceRegistry** - Factory pattern registry for managing data source instances
3. **Data Source Implementations** - Concrete implementations of the IDataSource interface

```
┌─────────────────────────────────────────┐
│         DataSourceRegistry              │
│  (Singleton Factory)                    │
│                                         │
│  - register(type, factory)              │
│  - create(config) → IDataSource         │
│  - get(id) / getAll()                   │
│  - destroy(id) / destroyAll()           │
└─────────────────────────────────────────┘
                    │
                    │ creates
                    ▼
┌─────────────────────────────────────────┐
│         IDataSource Interface           │
│                                         │
│  - initialize() / destroy()             │
│  - getCompetitions()                    │
│  - getClasses(competitionId)            │
│  - getResults(competitionId, className) │
│  - startPolling() / stopPolling()       │
│  - supportsRealTime()                   │
└─────────────────────────────────────────┘
                    △
                    │ implements
        ┌───────────┴───────────┐
        │                       │
┌───────────────┐      ┌────────────────┐
│ LiveResults   │      │ Your Custom    │
│ DataSource    │      │ DataSource     │
└───────────────┘      └────────────────┘
```

## IDataSource Interface

### Type Definitions

```typescript
// src/shared/types/dataSource.ts

export type DataSourceType = 'liveresults' | 'manual' | 'csv' | 'custom';

export interface DataSourceConfig {
  id: string;                    // Unique identifier
  name: string;                  // Display name
  type: DataSourceType;          // Data source type
  enabled: boolean;              // Whether the source is enabled
  config: Record<string, any>;   // Type-specific configuration
}

export interface Competition {
  id: number;
  name: string;
  date?: string;
  organizer?: string;
}

export interface Class {
  name: string;
  distance?: number;
  climb?: number;
  numberOfControls?: number;
}

export interface Result {
  place: number;
  name: string;
  club: string;
  time: string;
  status: 'OK' | 'DNS' | 'DNF' | 'DSQ' | 'MP';
  bibNumber?: string;
  startTime?: string;
  finishTime?: string;
  timeBehind?: string;
  splits?: Split[];
}

export interface Split {
  controlCode: string;
  time: string;
  timeBehind?: string;
  place?: number;
}

export interface IDataSource {
  readonly config: DataSourceConfig;
  readonly initialized: boolean;

  // Lifecycle methods
  initialize(): Promise<void>;
  destroy(): void;

  // Data retrieval methods
  getCompetitions(): Promise<Competition[]>;
  getClasses(competitionId: number): Promise<Class[]>;
  getResults(competitionId: number, className: string): Promise<Result[]>;

  // Real-time updates (optional)
  startPolling?(competitionId: number, className: string, interval: number): void;
  stopPolling?(competitionId: number, className: string): void;
  supportsRealTime(): boolean;
}
```

### Method Specifications

#### `initialize(): Promise<void>`

Called when the data source is created. Use this to:
- Validate configuration
- Establish connections
- Perform initial setup
- Test API availability

**Example:**
```typescript
async initialize(): Promise<void> {
  if (!this.config.config.apiKey) {
    throw new Error('API key is required');
  }
  
  // Test connection
  await this.testConnection();
  this._initialized = true;
}
```

#### `destroy(): void`

Called when the data source is being removed. Use this to:
- Close connections
- Clear timers
- Release resources
- Clean up event listeners

**Example:**
```typescript
destroy(): void {
  this.stopAllPolling();
  this.clearCache();
  this._initialized = false;
}
```

#### `getCompetitions(): Promise<Competition[]>`

Fetch all available competitions from the data source.

**Returns:** Array of competitions with at minimum `id` and `name` fields.

**Example:**
```typescript
async getCompetitions(): Promise<Competition[]> {
  const response = await fetch(`${this.baseUrl}/competitions`);
  const data = await response.json();
  
  return data.map(comp => ({
    id: comp.id,
    name: comp.name,
    date: comp.date,
    organizer: comp.organizer
  }));
}
```

#### `getClasses(competitionId: number): Promise<Class[]>`

Fetch all classes for a specific competition.

**Parameters:**
- `competitionId` - The competition ID

**Returns:** Array of classes with at minimum `name` field.

**Example:**
```typescript
async getClasses(competitionId: number): Promise<Class[]> {
  const response = await fetch(`${this.baseUrl}/competitions/${competitionId}/classes`);
  const data = await response.json();
  
  return data.map(cls => ({
    name: cls.name,
    distance: cls.distance,
    climb: cls.climb,
    numberOfControls: cls.controls
  }));
}
```

#### `getResults(competitionId: number, className: string): Promise<Result[]>`

Fetch results for a specific class in a competition.

**Parameters:**
- `competitionId` - The competition ID
- `className` - The class name

**Returns:** Array of results sorted by place.

**Example:**
```typescript
async getResults(competitionId: number, className: string): Promise<Result[]> {
  const response = await fetch(
    `${this.baseUrl}/competitions/${competitionId}/classes/${className}/results`
  );
  const data = await response.json();
  
  return data.map(result => ({
    place: result.place,
    name: result.name,
    club: result.club,
    time: result.time,
    status: result.status,
    bibNumber: result.bib,
    splits: result.splits
  }));
}
```

#### `startPolling(competitionId, className, interval)` (Optional)

Start polling for real-time updates.

**Parameters:**
- `competitionId` - The competition ID
- `className` - The class name
- `interval` - Polling interval in milliseconds

**Example:**
```typescript
startPolling(competitionId: number, className: string, interval: number): void {
  const key = `${competitionId}-${className}`;
  
  const timer = setInterval(async () => {
    const results = await this.getResults(competitionId, className);
    this.emit('results:updated', { competitionId, className, results });
  }, interval);
  
  this.pollingTimers.set(key, timer);
}
```

#### `stopPolling(competitionId, className)` (Optional)

Stop polling for a specific competition/class.

**Example:**
```typescript
stopPolling(competitionId: number, className: string): void {
  const key = `${competitionId}-${className}`;
  const timer = this.pollingTimers.get(key);
  
  if (timer) {
    clearInterval(timer);
    this.pollingTimers.delete(key);
  }
}
```

#### `supportsRealTime(): boolean`

Indicates whether this data source supports real-time updates.

**Returns:** `true` if `startPolling` and `stopPolling` are implemented.

**Example:**
```typescript
supportsRealTime(): boolean {
  return true; // or false if polling not supported
}
```

## Creating a Custom Data Source

### Step 1: Implement the Interface

Create a new file in `src/main/data/sources/`:

```typescript
// src/main/data/sources/MyCustomDataSource.ts

import { IDataSource, DataSourceConfig, Competition, Class, Result } from '../../../shared/types/dataSource';

export interface MyCustomDataSourceConfig extends DataSourceConfig {
  type: 'custom';
  config: {
    apiUrl: string;
    apiKey: string;
    timeout?: number;
  };
}

export class MyCustomDataSource implements IDataSource {
  readonly config: MyCustomDataSourceConfig;
  private _initialized: boolean = false;

  constructor(config: MyCustomDataSourceConfig) {
    this.config = config;
  }

  get initialized(): boolean {
    return this._initialized;
  }

  async initialize(): Promise<void> {
    // Validate configuration
    if (!this.config.config.apiUrl) {
      throw new Error('API URL is required');
    }
    
    // Test connection
    const response = await fetch(`${this.config.config.apiUrl}/health`);
    if (!response.ok) {
      throw new Error('Failed to connect to API');
    }
    
    this._initialized = true;
  }

  destroy(): void {
    this._initialized = false;
  }

  async getCompetitions(): Promise<Competition[]> {
    const response = await fetch(`${this.config.config.apiUrl}/competitions`, {
      headers: {
        'Authorization': `Bearer ${this.config.config.apiKey}`
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch competitions');
    }
    
    return await response.json();
  }

  async getClasses(competitionId: number): Promise<Class[]> {
    const response = await fetch(
      `${this.config.config.apiUrl}/competitions/${competitionId}/classes`,
      {
        headers: {
          'Authorization': `Bearer ${this.config.config.apiKey}`
        }
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch classes');
    }
    
    return await response.json();
  }

  async getResults(competitionId: number, className: string): Promise<Result[]> {
    const response = await fetch(
      `${this.config.config.apiUrl}/competitions/${competitionId}/classes/${encodeURIComponent(className)}/results`,
      {
        headers: {
          'Authorization': `Bearer ${this.config.config.apiKey}`
        }
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch results');
    }
    
    return await response.json();
  }

  supportsRealTime(): boolean {
    return false; // No polling support in this example
  }
}
```

### Step 2: Register the Data Source

Add your data source to the registry in `src/main/data/sources/index.ts`:

```typescript
import { getDataSourceRegistry } from '../DataSourceRegistry';
import { MyCustomDataSource, MyCustomDataSourceConfig } from './MyCustomDataSource';

export function registerBuiltInDataSources(): void {
  const registry = getDataSourceRegistry();
  
  // ... existing registrations
  
  // Register your custom data source
  registry.register({
    type: 'custom',
    factory: (config: MyCustomDataSourceConfig) => new MyCustomDataSource(config),
    displayName: 'My Custom Data Source',
    description: 'Fetch data from my custom API'
  });
}
```

### Step 3: Add Configuration

Users can now add your data source through the Settings > Data tab UI, or by editing the config file:

```json
{
  "dataSources": [
    {
      "id": "my-custom-source",
      "name": "My Custom Source",
      "type": "custom",
      "enabled": true,
      "config": {
        "apiUrl": "https://api.example.com",
        "apiKey": "your-api-key-here",
        "timeout": 10000
      }
    }
  ]
}
```

## Best Practices

1. **Error Handling** - Always throw descriptive errors with context
2. **Validation** - Validate configuration in `initialize()`
3. **Cleanup** - Properly clean up resources in `destroy()`
4. **Caching** - Consider caching data to reduce API calls
5. **Timeouts** - Implement request timeouts to prevent hanging
6. **Logging** - Use the logger utility for debugging
7. **Type Safety** - Use TypeScript interfaces for type safety

## Testing

Test your data source implementation:

```typescript
// Example test
const config: MyCustomDataSourceConfig = {
  id: 'test',
  name: 'Test Source',
  type: 'custom',
  enabled: true,
  config: {
    apiUrl: 'https://api.example.com',
    apiKey: 'test-key'
  }
};

const source = new MyCustomDataSource(config);
await source.initialize();

const competitions = await source.getCompetitions();
console.log('Competitions:', competitions);

const classes = await source.getClasses(competitions[0].id);
console.log('Classes:', classes);

const results = await source.getResults(competitions[0].id, classes[0].name);
console.log('Results:', results);

source.destroy();
```

## See Also

- [Migration Guide](./migration-guide.md) - Migrating from old LiveResults configuration
- [IDataSource Interface](../src/shared/types/dataSource.ts) - Full type definitions
- [LiveResultsDataSource](../src/main/data/sources/LiveResultsDataSource.ts) - Reference implementation

