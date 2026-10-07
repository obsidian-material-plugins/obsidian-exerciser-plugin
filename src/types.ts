export type ExerciseLayout = 'ide' | 'dropdown';
export type OutputType = 'normal' | 'stderr' | 'raw' | 'file';

export interface ExerciseFenceConfig {
	exercise: string;
	layout: ExerciseLayout;
	entrypoint?: string;
	'word-wrap': boolean;
}

export interface ExerciseOutputExample {
	label?: string;
	type: OutputType;
	'content-file'?: string;
	content?: string;
	file?: string;
	fallback?: string;
}

export interface ExerciseOutputAssociation {
	source: string;
	heading?: string;
	examples: ExerciseOutputExample[];
}

export interface ExerciseHighlightRange {
	lines: string;
	note?: string;
	accent?: string;
}

export interface ExerciseHighlight {
	source: string;
	ranges: ExerciseHighlightRange[];
}

export interface ExerciseAnnotation {
	source: string;
	line: number;
	text: string;
	'inject-into-export': boolean;
}

export interface ExerciseManifest {
	version: 1;
	files: {
		'hide-from-preview': string[];
		'exclude-from-quartz': string[];
	};
	preview: { 'ignore-size-limit': boolean };
	outputs: ExerciseOutputAssociation[];
	highlights: ExerciseHighlight[];
	annotations: ExerciseAnnotation[];
}

export interface ExerciserPluginData {
	ignoreRuleProvisioned: boolean;
	destinationNoticeShown: boolean;
}

export type ExerciseFileSource = 'paste' | 'computer';

export interface ExerciseFileDraft {
	path: string;
	source: ExerciseFileSource;
	content: string;
	computerPath: string;
}

export interface ExerciseCreationSpec {
	name: string;
	files: ExerciseFileDraft[];
	manifest: ExerciseManifest;
	fence: ExerciseFenceConfig;
}

export interface ViewerFile {
	path: string;
	name: string;
	size: number;
	extension: string;
	kind: 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'binary' | 'oversized';
	content?: string;
	resourceUrl?: string;
}
