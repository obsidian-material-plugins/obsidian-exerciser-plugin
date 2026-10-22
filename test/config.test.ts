import { describe, expect, it } from 'vitest';
import {
	DEFAULT_PREVIEW_LIMIT_BYTES,
	normalizeExerciseName,
	normalizeRelativePath,
	parseFence,
	parseManifest,
	parsePreviewLimit,
	stringifyManifest,
} from '../src/config';

describe('exercise authoring contract', () => {
	it('parses every manifest setting and preserves it through YAML', () => {
		const manifest = parseManifest(`
version: 1
files:
  hide-from-preview: [solutions/**]
  exclude-from-quartz: [private/**]
preview:
  ignore-size-limit: true
outputs:
  - source: src/Main.java
    heading: Expected output
    examples:
      - label: Success
        type: normal
        content: hello
      - type: file
        file: expected/chart.png
        fallback: Chart not available
highlights:
  - source: src/Main.java
    ranges:
      - lines: 3-8
        note: Main loop
        accent: '#7c3aed'
annotations:
  - source: src/Main.java
    line: 4
    text: Start here
    inject-into-export: true
`);

		expect(parseManifest(stringifyManifest(manifest))).toEqual(manifest);
		expect(manifest.outputs[0]?.examples).toHaveLength(2);
		expect(manifest.highlights[0]?.ranges[0]?.accent).toBe('#7c3aed');
		expect(manifest.annotations[0]?.['inject-into-export']).toBe(true);
	});

	it('supports both layouts and traversal-safe paths', () => {
		expect(parseFence('exercise: hello-world\nlayout: dropdown\nentrypoint: src/Main.java\nword-wrap: false')).toEqual({
			exercise: 'hello-world',
			layout: 'dropdown',
			entrypoint: 'src/Main.java',
			'word-wrap': false,
		});
		expect(normalizeExerciseName('../escape')).toBeNull();
		expect(normalizeRelativePath('../escape.txt')).toBeNull();
		expect(parseFence('exercise: hello\nentrypoint: ../../secret')).toBeNull();
	});

	it('accepts underscore-prefixed template exercises without accepting paths', () => {
		expect(normalizeExerciseName('_template-exercise-1')).toBe('_template-exercise-1');
		expect(parseFence('exercise: _template-exercise-1')).toEqual({
			exercise: '_template-exercise-1',
			layout: 'ide',
			entrypoint: undefined,
			'word-wrap': true,
		});
		expect(normalizeExerciseName('.hidden')).toBeNull();
		expect(normalizeExerciseName('../escape')).toBeNull();
		expect(normalizeExerciseName('nested/exercise')).toBeNull();
		expect(normalizeExerciseName('C:\\exercise')).toBeNull();
	});

	it('uses 50 MB for absent or malformed root settings', () => {
		expect(parsePreviewLimit('')).toBe(DEFAULT_PREVIEW_LIMIT_BYTES);
		expect(parsePreviewLimit('---\nexercise-preview-size-limit: enormous\n---')).toBe(DEFAULT_PREVIEW_LIMIT_BYTES);
		expect(parsePreviewLimit('---\nexercise-preview-size-limit: 2 MB\n---')).toBe(2 * 1024 * 1024);
	});

	it('rejects missing and unsupported manifest versions', () => {
		expect(() => parseManifest('files: {}')).toThrow('version missing');
		expect(() => parseManifest('version: 2\nfiles: {}')).toThrow('version 2');
	});
});
