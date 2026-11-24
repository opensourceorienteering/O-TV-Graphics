/**
 * OGRAF Manifest Validator
 * Validates OGRAF v1 manifest files using JSON Schema
 */

import Ajv2020 from 'ajv/dist/2020';
import type { ValidateFunction, ErrorObject } from 'ajv';
import { OGrafManifest } from '../../shared/types/ograf';
import { logger } from '../utils/logger';

/**
 * The official OGraf v1 schemas (EBU, MIT), bundled so validation works offline and matches the
 * specification exactly: see ./ograf-schema/README.md
 */
import graphicsSchema from './ograf-schema/graphics/schema.json';
import gddObject from './ograf-schema/gdd/object.json';
import gddBasicTypes from './ograf-schema/gdd/basic-types.json';
import gddTypes from './ograf-schema/gdd/gdd-types.json';
import actionSchema from './ograf-schema/lib/action.json';
import booleanConstraint from './ograf-schema/lib/constraints/boolean.json';
import numberConstraint from './ograf-schema/lib/constraints/number.json';
import stringConstraint from './ograf-schema/lib/constraints/string.json';

const REFERENCED_SCHEMAS = [gddObject, gddBasicTypes, gddTypes, actionSchema, booleanConstraint, numberConstraint, stringConstraint];

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
  private ajv: Ajv2020;
  private validateManifest: ValidateFunction;

  constructor() {
    // JSON Schema 2020-12, as the official schemas are written. Formats (email, uri) are not
    // checked: the official schema leaves them to the controller.
    this.ajv = new Ajv2020({
      allErrors: true,
      verbose: true,
      strict: false,
      validateFormats: false,
      logger: false
    });
    for (const schema of REFERENCED_SCHEMAS) this.ajv.addSchema(schema as object);
    this.validateManifest = this.ajv.compile(graphicsSchema as object);
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

