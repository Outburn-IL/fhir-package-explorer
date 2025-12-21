import type { Logger, FhirPackageIdentifier, FhirVersion, FileInPackageIndex } from '@outburn/types';

export interface ExplorerConfig {

  logger?: Logger;
  registryUrl?: string;
  registryToken?: string;
  cachePath?: string;
  context: Array<string | FhirPackageIdentifier>;
  skipExamples?: boolean;
  /** 
   * FHIR version to use when auto-adding core package if none is found in context.
   * Defaults to '4.0.1'. 
   * Supports: '3.0.2', '3.0', 'R3' (STU3), '4.0.1', '4.0' (R4), '4.3.0', '4.3' (R4B), '5.0.0', '5.0' (R5)
   * If specified and no core package exists in context, automatically adds the appropriate hl7.fhir.rX.core package.
   */
  fhirVersion?: FhirVersion;
}

export interface LookupFilter extends Partial<FileInPackageIndex> {
  package?: string | FhirPackageIdentifier;
}