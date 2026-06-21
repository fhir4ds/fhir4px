/**
 * Global LLM toggle.
 *
 * Set to false to disable all LLM activity (model preload, naming pipeline,
 * lab-condition enrichment). The app falls back to deterministic naming +
 * source labels. Set to true to re-enable when the fine-tuned model is ready.
 *
 * Consumers:
 *   - AppFrame: gates mount-time preload
 *   - ProviderSearch: gates connect-time preload
 *   - PatientExplorer: gates the naming pipeline (canRunLocalModel)
 */
export const LLM_ENABLED = false;
