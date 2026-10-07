import fs from 'node:fs/promises';
import { App, normalizePath, TFile } from 'obsidian';
import { minimatch } from 'minimatch';
import {
	DEFAULT_MANIFEST,
	DEFAULT_PREVIEW_LIMIT_BYTES,
	EXERCISE_ROOT,
	MANIFEST_FILE,
	normalizeExerciseName,
	normalizeRelativePath,
	parseManifest,
	parsePreviewLimit,
	stringifyManifest,
} from './config';
import type { ExerciseCreationSpec, ExerciseManifest, ViewerFile } from './types';

const textExtensions = new Set([
	'c', 'cc', 'cpp', 'cs', 'css', 'csv', 'go', 'h', 'hpp', 'html', 'java', 'js', 'json', 'kt',
	'kts', 'md', 'mjs', 'php', 'properties', 'py', 'rb', 'rs', 'scala', 'sh', 'sql', 'svg',
	'toml', 'ts', 'tsx', 'txt', 'xml', 'yaml', 'yml',
]);
const imageExtensions = new Set(['avif', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const audioExtensions = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav']);
const videoExtensions = new Set(['m4v', 'mov', 'mp4', 'ogv', 'webm']);

export const viewerKindForExtension = (extension: string): ViewerFile['kind'] => {
	const normalized = extension.toLowerCase();
	if (imageExtensions.has(normalized)) return 'image';
	if (audioExtensions.has(normalized)) return 'audio';
	if (videoExtensions.has(normalized)) return 'video';
	if (normalized === 'pdf') return 'pdf';
	if (textExtensions.has(normalized) || !normalized) return 'text';
	return 'binary';
};

export interface LoadedExercise {
	name: string;
	root: string;
	manifest: ExerciseManifest;
	previewLimit: number;
	files: ViewerFile[];
}

export const exerciseRootPath = (name: string) => {
	const normalized = normalizeExerciseName(name);
	return normalized ? normalizePath(`${EXERCISE_ROOT}/${normalized}`) : null;
};

const matches = (relative: string, patterns: string[]) =>
	patterns.some((pattern) => minimatch(relative, pattern, { dot: true }));

export const loadManifest = async (app: App, root: string): Promise<ExerciseManifest> => {
	const manifestPath = normalizePath(`${root}/${MANIFEST_FILE}`);
	try {
		return parseManifest(await app.vault.adapter.read(manifestPath));
	} catch {
		return DEFAULT_MANIFEST();
	}
};

export const getPreviewLimit = async (app: App) => {
	try {
		return parsePreviewLimit(await app.vault.adapter.read('index.md'));
	} catch {
		return DEFAULT_PREVIEW_LIMIT_BYTES;
	}
};

export const getExerciseFiles = (app: App, root: string, manifest: ExerciseManifest) =>
	app.vault
		.getFiles()
		.filter((file) => file.path.startsWith(`${root}/`))
		.map((file) => ({ file, relative: file.path.slice(root.length + 1) }))
		.filter(({ relative }) =>
			relative !== MANIFEST_FILE &&
			!matches(relative, manifest.files['hide-from-preview']) &&
			!matches(relative, manifest.files['exclude-from-quartz']),
		)
		.sort((left, right) => left.relative.localeCompare(right.relative));

const classify = (
	file: TFile,
	limit: number,
	ignoreLimit: boolean,
): ViewerFile['kind'] => {
	if (!ignoreLimit && file.stat.size > limit) return 'oversized';
	return viewerKindForExtension(file.extension);
};

export const loadExercise = async (app: App, name: string): Promise<LoadedExercise | null> => {
	const root = exerciseRootPath(name);
	if (!root || !(await app.vault.adapter.exists(root))) return null;
	const manifest = await loadManifest(app, root);
	const previewLimit = await getPreviewLimit(app);
	const files: ViewerFile[] = [];
	for (const { file, relative } of getExerciseFiles(app, root, manifest)) {
		const kind = classify(file, previewLimit, manifest.preview['ignore-size-limit']);
		files.push({
			path: relative,
			name: file.name,
			size: file.stat.size,
			extension: file.extension.toLowerCase(),
			kind,
			content: kind === 'text' ? await app.vault.cachedRead(file) : undefined,
			resourceUrl: kind !== 'text' ? app.vault.getResourcePath(file) : undefined,
		});
	}
	return { name, root, manifest, previewLimit, files };
};

export const createExercise = async (app: App, name: string) => {
	const root = exerciseRootPath(name);
	if (!root) throw new Error('Invalid exercise name.');
	if (await app.vault.adapter.exists(root)) throw new Error('Exercise already exists.');
	await app.vault.createFolder(root);
	await app.vault.create(
		normalizePath(`${root}/${MANIFEST_FILE}`),
		`version: 1\nfiles:\n  hide-from-preview: []\n  exclude-from-quartz: []\npreview:\n  ignore-size-limit: false\noutputs: []\nhighlights: []\nannotations: []\n`,
	);
	return root;
};

const ensureFolder = async (app: App, folder: string) => {
	const parts = normalizePath(folder).split('/');
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!(await app.vault.adapter.exists(current))) await app.vault.createFolder(current);
	}
};

export const createExerciseFromSpec = async (app: App, spec: ExerciseCreationSpec) => {
	const root = exerciseRootPath(spec.name);
	if (!root) throw new Error('Use letters, numbers, dots, dashes, or underscores for the exercise name.');
	if (await app.vault.adapter.exists(root)) throw new Error('An exercise with this name already exists.');
	if (!spec.files.length) throw new Error('Add at least one exercise file.');

	const prepared: Array<{ path: string; bytes: ArrayBuffer }> = [];
	const seen = new Set<string>();
	for (const file of spec.files) {
		const relative = normalizeRelativePath(file.path);
		if (!relative) throw new Error(`Invalid exercise file path: ${file.path || '(empty)'}.`);
		const key = relative.toLowerCase();
		if (seen.has(key)) throw new Error(`Exercise file paths must be unique: ${relative}.`);
		seen.add(key);
		const bytes = file.source === 'paste'
			? new TextEncoder().encode(file.content)
			: new Uint8Array(await fs.readFile(file.computerPath));
		prepared.push({
			path: relative,
			bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
		});
	}

	await ensureFolder(app, root);
	for (const file of prepared) {
		const slash = file.path.lastIndexOf('/');
		if (slash > 0) await ensureFolder(app, `${root}/${file.path.slice(0, slash)}`);
		await app.vault.createBinary(normalizePath(`${root}/${file.path}`), file.bytes);
	}
	await app.vault.create(
		normalizePath(`${root}/${MANIFEST_FILE}`),
		stringifyManifest(spec.manifest),
	);
	return root;
};
