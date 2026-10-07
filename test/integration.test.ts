import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MANIFEST, parseManifest } from '../src/config';
import type { ExerciseCreationSpec } from '../src/types';
import { createExerciseFromSpec } from '../src/vault-service';

describe('wizard creation integration', () => {
	const files = new Map<string, string | ArrayBuffer>();
	const folders = new Set<string>();
	const app = {
		vault: {
			adapter: {
				exists: async (path: string) => files.has(path) || folders.has(path),
			},
			createFolder: async (path: string) => void folders.add(path),
			createBinary: async (path: string, content: ArrayBuffer) => void files.set(path, content),
			create: async (path: string, content: string) => {
				files.set(path, content);
				return {};
			},
		},
	};

	beforeEach(() => {
		files.clear();
		folders.clear();
	});

	it('writes nested pasted files and a generated sidecar under the fixed root', async () => {
		const manifest = DEFAULT_MANIFEST();
		manifest.highlights.push({ source: 'src/main.py', ranges: [{ lines: '1', note: 'Entry' }] });
		const spec: ExerciseCreationSpec = {
			name: 'hello-python',
			files: [{ path: 'src/main.py', source: 'paste', content: 'print("hello")\n', computerPath: '' }],
			manifest,
			fence: { exercise: 'hello-python', layout: 'ide', entrypoint: 'src/main.py', 'word-wrap': true },
		};

		await createExerciseFromSpec(app as never, spec);

		expect(folders.has('assets/exercises/hello-python/src')).toBe(true);
		const bytes = files.get('assets/exercises/hello-python/src/main.py');
		expect(new TextDecoder().decode(bytes as ArrayBuffer)).toBe('print("hello")\n');
		const sidecar = files.get('assets/exercises/hello-python/.exercise.yml');
		expect(parseManifest(sidecar as string)).toEqual(manifest);
	});

	it('rejects duplicate and escaping paths before creating a folder', async () => {
		const base: ExerciseCreationSpec = {
			name: 'unsafe',
			files: [
				{ path: '../secret', source: 'paste', content: '', computerPath: '' },
			],
			manifest: DEFAULT_MANIFEST(),
			fence: { exercise: 'unsafe', layout: 'ide', 'word-wrap': true },
		};
		await expect(createExerciseFromSpec(app as never, base)).rejects.toThrow('Invalid exercise file path');
		expect(folders.size).toBe(0);
	});
});
