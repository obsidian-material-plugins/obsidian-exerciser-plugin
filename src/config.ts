import YAML from 'yaml';
import type {
	ExerciseAnnotation,
	ExerciseFenceConfig,
	ExerciseHighlight,
	ExerciseManifest,
	ExerciseOutputAssociation,
} from './types';

export const EXERCISE_ROOT = 'assets/exercises';
export const DOCUMENTED_EXERCISE_ROOT = 'content/assets/exercises';
export const MANIFEST_FILE = '.exercise.yml';
export const DEFAULT_PREVIEW_LIMIT_BYTES = 50 * 1024 * 1024;

export const DEFAULT_MANIFEST = (): ExerciseManifest => ({
	version: 1,
	files: { 'hide-from-preview': [], 'exclude-from-quartz': [] },
	preview: { 'ignore-size-limit': false },
	outputs: [],
	highlights: [],
	annotations: [],
});

const object = (value: unknown): Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
const string = (value: unknown) =>
	typeof value === 'string' && value.trim() ? value.trim() : undefined;
const strings = (value: unknown): string[] =>
	Array.isArray(value)
		? value.flatMap((item) => {
				const text = string(item);
				return text ? [text] : [];
			})
		: [];

export const normalizeExerciseName = (value: unknown): string | null => {
	const name = string(value);
	return name && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && name !== '.'
		? name
		: null;
};

export const normalizeRelativePath = (value: string): string | null => {
	const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
	if (
		!normalized ||
		normalized.startsWith('/') ||
		/^[A-Za-z]:/.test(normalized) ||
		normalized.split('/').some((segment) => !segment || segment === '..')
	)
		return null;
	return normalized;
};

const patterns = (value: unknown) =>
	strings(value).flatMap((pattern) => {
		const clean = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
		if (
			clean.startsWith('/') ||
			clean.startsWith('!') ||
			/^[A-Za-z]:/.test(clean) ||
			clean.split('/').some((segment) => !segment || segment === '..')
		)
			return [];
		return [clean];
	});

const outputs = (value: unknown): ExerciseOutputAssociation[] => {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const row = object(item);
		const source = string(row.source);
		const safeSource = source ? normalizeRelativePath(source) : null;
		const examples = Array.isArray(row.examples)
			? row.examples.flatMap((example) => {
					const data = object(example);
					const type = string(data.type);
					if (!type || !['normal', 'stderr', 'raw', 'file'].includes(type)) return [];
					const contentFile = string(data['content-file']);
					const file = string(data.file);
					if (contentFile && !normalizeRelativePath(contentFile)) return [];
					if (file && !normalizeRelativePath(file)) return [];
					return [{
						label: string(data.label),
						type: type as ExerciseOutputAssociation['examples'][number]['type'],
						'content-file': contentFile,
						content: typeof data.content === 'string' ? data.content : undefined,
						file,
						fallback: typeof data.fallback === 'string' ? data.fallback : undefined,
					}];
				})
			: [];
		return safeSource && examples.length
			? [{ source: safeSource, heading: string(row.heading), examples }]
			: [];
	});
};

const highlights = (value: unknown): ExerciseHighlight[] => {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const row = object(item);
		const source = string(row.source);
		const safeSource = source ? normalizeRelativePath(source) : null;
		const ranges = Array.isArray(row.ranges)
			? row.ranges.flatMap((range) => {
					const data = object(range);
					const lines = string(data.lines);
					if (!lines || !/^\d+(?:-\d+)?$/.test(lines)) return [];
					const accent = string(data.accent);
					return [{
						lines,
						note: string(data.note),
						accent: accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : undefined,
					}];
				})
			: [];
		return safeSource && ranges.length ? [{ source: safeSource, ranges }] : [];
	});
};

const annotations = (value: unknown): ExerciseAnnotation[] => {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const row = object(item);
		const source = string(row.source);
		const safeSource = source ? normalizeRelativePath(source) : null;
		const line = typeof row.line === 'number' ? Math.floor(row.line) : 0;
		const text = string(row.text);
		return safeSource && line > 0 && text
			? [{
					source: safeSource,
					line,
					text,
					'inject-into-export': row['inject-into-export'] === true,
				}]
			: [];
	});
};

export const parseManifest = (source: string): ExerciseManifest => {
	const parsed = object(YAML.parse(source));
	const manifest = DEFAULT_MANIFEST();
	const files = object(parsed.files);
	const preview = object(parsed.preview);
	manifest.files['hide-from-preview'] = patterns(files['hide-from-preview']);
	manifest.files['exclude-from-quartz'] = patterns(files['exclude-from-quartz']);
	manifest.preview['ignore-size-limit'] = preview['ignore-size-limit'] === true;
	manifest.outputs = outputs(parsed.outputs);
	manifest.highlights = highlights(parsed.highlights);
	manifest.annotations = annotations(parsed.annotations);
	return manifest;
};

export const stringifyManifest = (manifest: ExerciseManifest) => YAML.stringify(manifest);

export const parseFence = (source: string): ExerciseFenceConfig | null => {
	try {
		const parsed = object(YAML.parse(source));
		const exercise = normalizeExerciseName(parsed.exercise);
		if (!exercise) return null;
		const entrypoint = string(parsed.entrypoint);
		const safeEntrypoint = entrypoint ? normalizeRelativePath(entrypoint) : undefined;
		if (entrypoint && !safeEntrypoint) return null;
		return {
			exercise,
			layout: parsed.layout === 'dropdown' ? 'dropdown' : 'ide',
			entrypoint: safeEntrypoint ?? undefined,
			'word-wrap': parsed['word-wrap'] !== false,
		};
	} catch {
		return null;
	}
};

export const parsePreviewLimit = (source: string): number => {
	const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/m.exec(source);
	if (!match) return DEFAULT_PREVIEW_LIMIT_BYTES;
	try {
		const frontmatter = object(YAML.parse(match[1]!));
		const raw = frontmatter['exercise-preview-size-limit'];
		if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
		if (typeof raw !== 'string') return DEFAULT_PREVIEW_LIMIT_BYTES;
		const size = /^\s*(\d+(?:\.\d+)?)\s*(KB|MB|GB)\s*$/i.exec(raw);
		if (!size) return DEFAULT_PREVIEW_LIMIT_BYTES;
		const unit = size[2]!.toUpperCase();
		const multiplier = unit === 'KB' ? 1024 : unit === 'MB' ? 1024 ** 2 : 1024 ** 3;
		const result = Number(size[1]!) * multiplier;
		return Number.isFinite(result) && result > 0
			? Math.floor(result)
			: DEFAULT_PREVIEW_LIMIT_BYTES;
	} catch {
		return DEFAULT_PREVIEW_LIMIT_BYTES;
	}
};
