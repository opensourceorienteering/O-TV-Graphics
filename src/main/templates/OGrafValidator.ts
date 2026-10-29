/**
 * OGRAF Manifest Validator
 * Validates OGRAF v1 manifest files using JSON Schema
 */

import Ajv, { ValidateFunction, ErrorObject } from 'ajv';
import { OGrafManifest } from '../../shared/types/ograf';
import { logger } from '../utils/logger';

/**
 * JSON Schema for OGRAF v1 Manifest
 * Based on https://ograf.ebu.io/v1/specification/
 */
const OGRAF_MANIFEST_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  // Matches the official v1 schema (https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json)
  required: ['$schema', 'id', 'name', 'main', 'supportsRealTime', 'supportsNonRealTime'],
  properties: {
    $schema: {
      type: 'string',
      const: 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json',
      description: 'OGRAF v1 graphics schema reference (required as of 2025-07-13)'
    },
    id: {
      type: 'string',
      minLength: 1,
      description: 'Unique identifier for the graphic'
    },
    version: {
      type: 'string',
      description: 'Graphic version; any alphabetically sortable string (e.g. "1.0.0", "2", "2024-07-01_final")'
    },
    name: {
      type: 'string',
      minLength: 1,
      description: 'Human-readable name'
    },
    description: {
      type: 'string',
      description: 'Description of the graphic'
    },
    author: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1 },
        email: { type: 'string', format: 'email' },
        url: { type: 'string', format: 'uri' }
      }
    },
    main: {
      type: 'string',
      pattern: '\\.(js|mjs)$',
      description: 'Main JavaScript file (Web Component)'
    },
    schema: {
      type: 'object',
      required: ['type', 'properties'],
      properties: {
        type: { const: 'object' },
        properties: { type: 'object' },
        required: { type: 'array', items: { type: 'string' } }
      },
      description: 'JSON Schema for data validation'
    },
    supportsRealTime: {
      type: 'boolean',
      description: 'Supports real-time rendering'
    },
    supportsNonRealTime: {
      type: 'boolean',
      description: 'Supports non-real-time rendering'
    },
    stepCount: {
      type: 'number',
      minimum: -1,
      description: 'Number of steps (default 1; -1 = dynamic/unknown number of steps)'
    },
    thumbnails: {
      type: 'array',
      description: 'Thumbnail images (PNG, JPG, GIF, webp) relative to the manifest (added 2026-04)',
      items: {
        type: 'object',
        required: ['file'],
        properties: {
          file: { type: 'string', minLength: 1 },
          resolution: {
            type: 'object',
            properties: {
              width: { type: 'integer', minimum: 1 },
              height: { type: 'integer', minimum: 1 }
            }
          }
        }
      }
    },
    actionDurations: {
      type: 'array',
      description: 'Static animation durations per action in ms, -1 = dynamic (added 2026-06)',
      items: {
        type: 'object',
        required: ['type'],
        properties: {
          type: { type: 'string' },
          duration: { type: 'integer', minimum: -1 }
        }
      }
    },
    customActions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string', minLength: 1 },
          name: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          // null when the action takes no parameters (lib/action.json)
          schema: { type: ['object', 'null'] }
        }
      }
    },
    renderRequirements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          resolution: {
            type: 'object',
            properties: {
              width: {
                type: 'object',
                properties: {
                  exact: { type: 'integer', minimum: 1 },
                  min: { type: 'integer', minimum: 1 },
                  max: { type: 'integer', minimum: 1 },
                  ideal: { type: 'integer', minimum: 1 }
                }
              },
              height: {
                type: 'object',
                properties: {
                  exact: { type: 'integer', minimum: 1 },
                  min: { type: 'integer', minimum: 1 },
                  max: { type: 'integer', minimum: 1 },
                  ideal: { type: 'integer', minimum: 1 }
                }
              }
            }
          },
          frameRate: {
            type: 'object',
            properties: {
              exact: { type: 'number', minimum: 1 },
              min: { type: 'number', minimum: 1 },
              max: { type: 'number', minimum: 1 },
              ideal: { type: 'number', minimum: 1 }
            }
          },
          accessToPublicInternet: {
            type: 'object',
            required: ['exact'],
            properties: {
              exact: { type: 'boolean' }
            }
          },
          engine: {
            type: 'array',
            description: 'Minimum rendering engine versions, e.g. { type: "CEF", version: { min: 139 } } (added 2026-04)',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                version: { type: 'object' }
              }
            }
          }
        }
      }
    }
  },
  // Allow vendor-specific fields starting with v_
  patternProperties: {
    '^v_[a-zA-Z0-9_]+$': {}
  },
  additionalProperties: false
};

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

/**
 * Validation error details
 */
export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

/**
 * OGRAF Validator class
 */
export class OGrafValidator {
  private ajv: Ajv;
  private validateManifest: ValidateFunction;

  constructor() {
    // Initialize Ajv with strict mode
    this.ajv = new Ajv({
      allErrors: true,
      verbose: true,
      strict: true,
      strictSchema: false, // Allow additional schema keywords
      logger: false // Suppress format warnings (email, uri) - these are cosmetic only
    });

    // Compile the manifest schema
    this.validateManifest = this.ajv.compile(OGRAF_MANIFEST_SCHEMA);
  }

  /**
   * Validate an OGRAF manifest
   */
  validate(manifest: unknown): ValidationResult {
    const valid = this.validateManifest(manifest);

    if (valid) {
      logger.debug('OGRAF manifest validation passed', { id: (manifest as OGrafManifest).id });
      return { valid: true };
    }

    const errors = this.formatErrors(this.validateManifest.errors || []);
    logger.warn('OGRAF manifest validation failed', { 
      errors,
      manifest: manifest 
    });

    return { valid: false, errors };
  }

  /**
   * Validate and type-cast manifest
   */
  validateAndCast(manifest: unknown): { valid: true; manifest: OGrafManifest } | { valid: false; errors: ValidationError[] } {
    const result = this.validate(manifest);
    
    if (result.valid) {
      return { valid: true, manifest: manifest as OGrafManifest };
    }
    
    return { valid: false, errors: result.errors || [] };
  }

  /**
   * Format Ajv errors into user-friendly messages
   */
  private formatErrors(ajvErrors: ErrorObject[]): ValidationError[] {
    return ajvErrors.map(error => {
      const field = error.instancePath || error.schemaPath;
      let message = error.message || 'Validation error';

      // Enhance error messages
      switch (error.keyword) {
        case 'required':
          message = `Missing required field: ${error.params.missingProperty}`;
          break;
        case 'type':
          message = `Invalid type: expected ${error.params.type}`;
          break;
        case 'pattern':
          message = `Invalid format: ${error.message}`;
          break;
        case 'minLength':
          message = `Value too short: minimum length is ${error.params.limit}`;
          break;
        case 'minimum':
          message = `Value too small: minimum is ${error.params.limit}`;
          break;
        case 'const':
          message = `Value must be: ${error.params.allowedValue}`;
          break;
        case 'additionalProperties':
          message = `Unknown field: ${error.params.additionalProperty}`;
          break;
      }

      return {
        field: field.replace(/^\//, '').replace(/\//g, '.'),
        message,
        value: error.data
      };
    });
  }

  /**
   * Validate manifest file path
   */
  validateFilePath(filePath: string): ValidationResult {
    if (!filePath.endsWith('manifest.json')) {
      return {
        valid: false,
        errors: [{
          field: 'filePath',
          message: 'Manifest file must be named "manifest.json"',
          value: filePath
        }]
      };
    }

    return { valid: true };
  }

  /**
   * Validate main file reference
   */
  validateMainFile(mainFile: string): ValidationResult {
    if (!mainFile.match(/\.(js|mjs)$/)) {
      return {
        valid: false,
        errors: [{
          field: 'main',
          message: 'Main file must have .js or .mjs extension',
          value: mainFile
        }]
      };
    }

    return { valid: true };
  }
}

/**
 * Singleton instance
 */
let validatorInstance: OGrafValidator | null = null;

/**
 * Get validator instance
 */
export function getValidator(): OGrafValidator {
  if (!validatorInstance) {
    validatorInstance = new OGrafValidator();
  }
  return validatorInstance;
}

/**
 * Convenience function to validate a manifest
 */
export function validateManifest(manifest: unknown): ValidationResult {
  return getValidator().validate(manifest);
}

/**
 * Convenience function to validate and cast a manifest
 */
export function validateAndCastManifest(manifest: unknown): 
  { valid: true; manifest: OGrafManifest } | { valid: false; errors: ValidationError[] } {
  return getValidator().validateAndCast(manifest);
}

