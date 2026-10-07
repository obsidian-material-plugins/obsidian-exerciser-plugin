import path from 'node:path';
import { App, Modal, Notice, Setting } from 'obsidian';
import { chooseFiles } from '../copy-service';
import {
	DEFAULT_MANIFEST,
	normalizeExerciseName,
	normalizeRelativePath,
} from '../config';
import type {
	ExerciseAnnotation,
	ExerciseCreationSpec,
	ExerciseFileDraft,
	ExerciseHighlightRange,
	ExerciseOutputExample,
} from '../types';

interface FileMetadataDraft {
	highlights: ExerciseHighlightRange[];
	annotations: Omit<ExerciseAnnotation, 'source'>[];
	output: { heading: string; examples: ExerciseOutputExample[] } | null;
}

interface WizardState {
	name: string;
	files: ExerciseFileDraft[];
	metadata: FileMetadataDraft[];
	hidePatterns: string;
	excludePatterns: string;
	ignoreSizeLimit: boolean;
	layout: 'ide' | 'dropdown';
	entrypoint: string;
	wordWrap: boolean;
}

const newFile = (): ExerciseFileDraft => ({
	path: '',
	source: 'paste',
	content: '',
	computerPath: '',
});

const newMetadata = (): FileMetadataDraft => ({ highlights: [], annotations: [], output: null });

const lines = (value: string) =>
	value
		.split(/\r?\n/)
		.map((item) => item.trim())
		.filter(Boolean);

const textInput = (
	parent: HTMLElement,
	value: string,
	placeholder: string,
	onChange: (value: string) => void,
) => {
	const input = parent.createEl('input', {
		type: 'text',
		attr: { value, placeholder },
	});
	input.addEventListener('input', () => onChange(input.value));
	return input;
};

const selectInput = (
	parent: HTMLElement,
	value: string,
	options: Array<[string, string]>,
	onChange: (value: string) => void,
) => {
	const select = parent.createEl('select');
	for (const [optionValue, label] of options) {
		const option = select.createEl('option', { text: label, attr: { value: optionValue } });
		option.selected = optionValue === value;
	}
	select.addEventListener('change', () => onChange(select.value));
	return select;
};

const checkbox = (
	parent: HTMLElement,
	label: string,
	checked: boolean,
	onChange: (value: boolean) => void,
) => {
	const wrapper = parent.createEl('label', { cls: 'exerciser-wizard-check' });
	const input = wrapper.createEl('input', { type: 'checkbox' });
	input.checked = checked;
	input.addEventListener('change', () => onChange(input.checked));
	wrapper.createSpan({ text: label });
	return input;
};

export class NewExerciseWizardModal extends Modal {
	private step = 0;
	private readonly state: WizardState = {
		name: '',
		files: [newFile()],
		metadata: [newMetadata()],
		hidePatterns: '',
		excludePatterns: '',
		ignoreSizeLimit: false,
		layout: 'ide',
		entrypoint: '',
		wordWrap: true,
	};

	constructor(
		app: App,
		private readonly onCreate: (spec: ExerciseCreationSpec) => Promise<void>,
	) {
		super(app);
	}

	onOpen() {
		this.modalEl.addClass('exerciser-wizard-modal');
		this.render();
	}

	private setFileCount(count: number) {
		const safeCount = Math.min(100, Math.max(1, Math.floor(count) || 1));
		while (this.state.files.length < safeCount) {
			this.state.files.push(newFile());
			this.state.metadata.push(newMetadata());
		}
		this.state.files.length = safeCount;
		this.state.metadata.length = safeCount;
	}

	private render() {
		this.contentEl.empty();
		this.setTitle('Create an exercise here');
		const labels = ['Setup', 'Files', 'Highlights & notes', 'Outputs & policy', 'Viewer & review'];
		const progress = this.contentEl.createDiv('exerciser-wizard-progress');
		labels.forEach((label, index) => {
			const item = progress.createSpan({ text: `${index + 1}. ${label}` });
			item.toggleClass('is-active', index === this.step);
			item.toggleClass('is-complete', index < this.step);
		});
		const body = this.contentEl.createDiv('exerciser-wizard-body');
		if (this.step === 0) this.renderSetup(body);
		if (this.step === 1) this.renderFiles(body);
		if (this.step === 2) this.renderPresentation(body);
		if (this.step === 3) this.renderOutputs(body);
		if (this.step === 4) this.renderReview(body);
		this.renderNavigation();
	}

	private renderSetup(body: HTMLElement) {
		body.createEl('h3', { text: 'Exercise setup' });
		body.createEl('p', {
			cls: 'exerciser-muted',
			text: 'The plugin creates the folder, files, .exercise.yml, and exercise block for you.',
		});
		new Setting(body)
			.setName('Exercise name')
			.setDesc('A folder name under content/assets/exercises. Spaces are not supported.')
			.addText((input) => input
				.setPlaceholder('Hello-world')
				.setValue(this.state.name)
				.onChange((value) => (this.state.name = value.trim())));
		new Setting(body)
			.setName('Number of files')
			.setDesc('You can add or remove files again on the next screen.')
			.addText((input) => {
				input.inputEl.type = 'number';
				input.inputEl.min = '1';
				input.inputEl.max = '100';
				input.setValue(String(this.state.files.length)).onChange((value) => this.setFileCount(Number(value)));
			});
	}

	private renderFiles(body: HTMLElement) {
		body.createEl('h3', { text: `Files (${this.state.files.length})` });
		body.createEl('p', {
			cls: 'exerciser-muted',
			text: 'Paste code directly, enter an absolute computer path, or browse for one or more files.',
		});
		this.state.files.forEach((file, index) => this.renderFileCard(body, file, index));
		const add = body.createEl('button', { text: 'Add another file' });
		add.addEventListener('click', () => {
			this.state.files.push(newFile());
			this.state.metadata.push(newMetadata());
			this.render();
		});
	}

	private renderFileCard(body: HTMLElement, file: ExerciseFileDraft, index: number) {
		const card = body.createDiv('exerciser-wizard-card');
		const heading = card.createDiv('exerciser-wizard-card-heading');
		heading.createEl('strong', { text: `File ${index + 1}` });
		if (this.state.files.length > 1) {
			const remove = heading.createEl('button', { text: 'Remove', cls: 'clickable-icon' });
			remove.addEventListener('click', () => {
				this.state.files.splice(index, 1);
				this.state.metadata.splice(index, 1);
				this.render();
			});
		}
		const grid = card.createDiv('exerciser-wizard-grid');
		const pathField = grid.createEl('label');
		pathField.createSpan({ text: 'Path inside exercise' });
		textInput(pathField, file.path, 'src/Main.java', (value) => (file.path = value));
		const sourceField = grid.createEl('label');
		sourceField.createSpan({ text: 'Source' });
		selectInput(sourceField, file.source, [['paste', 'Paste content'], ['computer', 'Computer file']], (value) => {
			file.source = value === 'computer' ? 'computer' : 'paste';
			this.render();
		});
		if (file.source === 'paste') {
			const label = card.createEl('label', { cls: 'exerciser-wizard-stack' });
			label.createSpan({ text: 'File content' });
			const area = label.createEl('textarea', { attr: { placeholder: 'Paste code or text here…' } });
			area.value = file.content;
			area.addEventListener('input', () => (file.content = area.value));
		} else {
			const row = card.createDiv('exerciser-wizard-path-row');
			textInput(row, file.computerPath, 'C:\\Users\\…\\Main.java', (value) => (file.computerPath = value.trim()));
			const browse = row.createEl('button', { text: 'Browse…' });
			browse.addEventListener('click', () => {
				void (async () => {
					const chosen = await chooseFiles();
					if (!chosen.length) return;
					file.computerPath = chosen[0]!;
					if (!file.path) file.path = path.basename(chosen[0]!);
					for (const selected of chosen.slice(1)) {
						this.state.files.push({
							path: path.basename(selected),
							source: 'computer',
							content: '',
							computerPath: selected,
						});
						this.state.metadata.push(newMetadata());
					}
					this.render();
				})();
			});
		}
	}

	private renderPresentation(body: HTMLElement) {
		body.createEl('h3', { text: 'Highlights, notes, and annotations' });
		body.createEl('p', {
			cls: 'exerciser-muted',
			text: 'Highlights call attention to line ranges. Annotations attach a precise note to one line and can optionally become a source comment in exported copies.',
		});
		this.state.files.forEach((file, index) => {
			const metadata = this.state.metadata[index]!;
			const card = body.createDiv('exerciser-wizard-card');
			card.createEl('h4', { text: file.path || `File ${index + 1}` });
			card.createEl('strong', { text: 'Highlighted ranges' });
			metadata.highlights.forEach((range, rangeIndex) => {
				const row = card.createDiv('exerciser-wizard-repeat');
				textInput(row, range.lines, '3-8', (value) => (range.lines = value.trim()));
				textInput(row, range.note ?? '', 'Optional note', (value) => (range.note = value || undefined));
				const color = row.createEl('input', { type: 'color' });
				color.value = range.accent ?? '#7c3aed';
				color.title = 'Accent color';
				color.addEventListener('input', () => (range.accent = color.value));
				const clear = row.createEl('button', { text: range.accent ? 'Clear color' : 'Use color' });
				clear.addEventListener('click', () => {
					range.accent = range.accent ? undefined : color.value;
					this.render();
				});
				const remove = row.createEl('button', { text: 'Remove' });
				remove.addEventListener('click', () => {
					metadata.highlights.splice(rangeIndex, 1);
					this.render();
				});
			});
			const addRange = card.createEl('button', { text: 'Add highlight' });
			addRange.addEventListener('click', () => {
				metadata.highlights.push({ lines: '', note: undefined, accent: undefined });
				this.render();
			});
			card.createEl('strong', { text: 'Line annotations' });
			metadata.annotations.forEach((annotation, annotationIndex) => {
				const row = card.createDiv('exerciser-wizard-repeat');
				const line = textInput(row, String(annotation.line || ''), 'Line', (value) => (annotation.line = Number(value)));
				line.type = 'number';
				line.min = '1';
				textInput(row, annotation.text, 'Annotation text', (value) => (annotation.text = value));
				checkbox(row, 'Inject into copied source', annotation['inject-into-export'], (value) => (annotation['inject-into-export'] = value));
				const remove = row.createEl('button', { text: 'Remove' });
				remove.addEventListener('click', () => {
					metadata.annotations.splice(annotationIndex, 1);
					this.render();
				});
			});
			const addAnnotation = card.createEl('button', { text: 'Add annotation' });
			addAnnotation.addEventListener('click', () => {
				metadata.annotations.push({ line: 1, text: '', 'inject-into-export': false });
				this.render();
			});
		});
	}

	private renderOutputs(body: HTMLElement) {
		body.createEl('h3', { text: 'Expected outputs and publication policy' });
		this.state.files.forEach((file, index) => {
			const metadata = this.state.metadata[index]!;
			const card = body.createDiv('exerciser-wizard-card');
			const header = card.createDiv('exerciser-wizard-card-heading');
			header.createEl('h4', { text: file.path || `File ${index + 1}` });
			checkbox(header, 'Has expected output', metadata.output !== null, (enabled) => {
				metadata.output = enabled ? { heading: 'Expected output', examples: [{ type: 'normal', content: '' }] } : null;
				this.render();
			});
			if (!metadata.output) return;
			const heading = card.createEl('label', { cls: 'exerciser-wizard-stack' });
			heading.createSpan({ text: 'Output heading' });
			textInput(heading, metadata.output.heading, 'Expected output', (value) => (metadata.output!.heading = value));
			metadata.output.examples.forEach((example, exampleIndex) => this.renderOutputExample(card, metadata, example, exampleIndex));
			const add = card.createEl('button', { text: 'Add output example' });
			add.addEventListener('click', () => {
				metadata.output!.examples.push({ type: 'normal', content: '' });
				this.render();
			});
		});
		const policy = body.createDiv('exerciser-wizard-card');
		policy.createEl('h4', { text: 'Manifest policy' });
		const grid = policy.createDiv('exerciser-wizard-grid');
		for (const [label, description, key] of [
			['Hide from preview', 'One glob pattern per line. Hidden files stay in ZIP/copies.', 'hidePatterns'],
			['Exclude from Quartz', 'One glob pattern per line. Excluded files are not published or copied.', 'excludePatterns'],
		] as const) {
			const field = grid.createEl('label', { cls: 'exerciser-wizard-stack' });
			field.createSpan({ text: label });
			field.createEl('small', { text: description });
			const area = field.createEl('textarea', { attr: { placeholder: 'Solutions/**' } });
			area.value = this.state[key];
			area.addEventListener('input', () => (this.state[key] = area.value));
		}
		checkbox(policy, 'Allow previews larger than the site limit', this.state.ignoreSizeLimit, (value) => (this.state.ignoreSizeLimit = value));
	}

	private renderOutputExample(
		card: HTMLElement,
		metadata: FileMetadataDraft,
		example: ExerciseOutputExample,
		index: number,
	) {
		const section = card.createDiv('exerciser-wizard-subcard');
		const header = section.createDiv('exerciser-wizard-card-heading');
		header.createEl('strong', { text: `Example ${index + 1}` });
		if (metadata.output!.examples.length > 1) {
			const remove = header.createEl('button', { text: 'Remove' });
			remove.addEventListener('click', () => {
				metadata.output!.examples.splice(index, 1);
				this.render();
			});
		}
		const grid = section.createDiv('exerciser-wizard-grid');
		const label = grid.createEl('label');
		label.createSpan({ text: 'Tab label (optional)' });
		textInput(label, example.label ?? '', 'Example 1', (value) => (example.label = value || undefined));
		const type = grid.createEl('label');
		type.createSpan({ text: 'Type' });
		selectInput(type, example.type, [['normal', 'Terminal output'], ['stderr', 'Error output'], ['raw', 'Raw text'], ['file', 'Output file']], (value) => {
			example.type = value as ExerciseOutputExample['type'];
			this.render();
		});
		if (example.type === 'file') {
			const file = grid.createEl('label');
			file.createSpan({ text: 'Output file path' });
			textInput(file, example.file ?? '', 'expected/result.png', (value) => (example.file = value || undefined));
		} else {
			const contentFile = grid.createEl('label');
			contentFile.createSpan({ text: 'Read content from exercise file (optional)' });
			textInput(contentFile, example['content-file'] ?? '', 'expected/output.txt', (value) => (example['content-file'] = value || undefined));
			const content = section.createEl('label', { cls: 'exerciser-wizard-stack' });
			content.createSpan({ text: 'Pasted expected content' });
			const area = content.createEl('textarea');
			area.value = example.content ?? '';
			area.addEventListener('input', () => (example.content = area.value || undefined));
		}
		const fallback = section.createEl('label', { cls: 'exerciser-wizard-stack' });
		fallback.createSpan({ text: 'Fallback text (optional)' });
		textInput(fallback, example.fallback ?? '', 'Shown when the referenced file is unavailable', (value) => (example.fallback = value || undefined));
	}

	private renderReview(body: HTMLElement) {
		body.createEl('h3', { text: 'Viewer placement and review' });
		const placement = body.createDiv('exerciser-wizard-card');
		const grid = placement.createDiv('exerciser-wizard-grid');
		const layout = grid.createEl('label');
		layout.createSpan({ text: 'Layout' });
		selectInput(layout, this.state.layout, [['ide', 'IDE: tree and tabs'], ['dropdown', 'Dropdown: compact selector']], (value) => (this.state.layout = value === 'dropdown' ? 'dropdown' : 'ide'));
		const entrypoint = grid.createEl('label');
		entrypoint.createSpan({ text: 'Initial file' });
		selectInput(entrypoint, this.state.entrypoint, [['', 'First file'], ...this.state.files.map((file) => [file.path, file.path] as [string, string])], (value) => (this.state.entrypoint = value));
		checkbox(placement, 'Wrap long lines', this.state.wordWrap, (value) => (this.state.wordWrap = value));

		const summary = body.createDiv('exerciser-wizard-summary');
		summary.createEl('strong', { text: `content/assets/exercises/${this.state.name}/` });
		const list = summary.createEl('ul');
		this.state.files.forEach((file) => list.createEl('li', { text: file.path }));
		list.createEl('li', { text: '.exercise.yml (generated)' });
		summary.createEl('p', { text: 'An exercise block will be inserted at the captured caret position.' });
	}

	private validateStep() {
		if (this.step === 0 && !normalizeExerciseName(this.state.name)) {
			return 'Enter an exercise name using letters, numbers, dots, dashes, or underscores.';
		}
		if (this.step >= 1) {
			const normalized = this.state.files.map((file) => normalizeRelativePath(file.path));
			if (normalized.some((item) => !item)) return 'Every file needs a safe path inside the exercise.';
			if (new Set(normalized.map((item) => item!.toLowerCase())).size !== normalized.length) return 'Exercise file paths must be unique.';
			if (this.state.files.some((file) => file.source === 'computer' && !file.computerPath)) return 'Choose or enter a computer file for every computer-file source.';
		}
		if (this.step >= 2) {
			for (const metadata of this.state.metadata) {
				if (metadata.highlights.some((range) => !/^\d+(?:-\d+)?$/.test(range.lines))) return 'Highlight ranges must look like 3 or 3-8.';
				if (metadata.annotations.some((annotation) => !Number.isInteger(annotation.line) || annotation.line < 1 || !annotation.text.trim())) return 'Every annotation needs a positive line number and note.';
			}
		}
		if (this.step >= 3) {
			for (const metadata of this.state.metadata) {
				for (const example of metadata.output?.examples ?? []) {
					if (example.file && !normalizeRelativePath(example.file)) return `Invalid output file path: ${example.file}.`;
					if (example['content-file'] && !normalizeRelativePath(example['content-file'])) return `Invalid output content path: ${example['content-file']}.`;
				}
			}
		}
		return null;
	}

	private buildSpec(): ExerciseCreationSpec {
		const manifest = DEFAULT_MANIFEST();
		manifest.files['hide-from-preview'] = lines(this.state.hidePatterns);
		manifest.files['exclude-from-quartz'] = lines(this.state.excludePatterns);
		manifest.preview['ignore-size-limit'] = this.state.ignoreSizeLimit;
		this.state.files.forEach((file, index) => {
			const metadata = this.state.metadata[index]!;
			if (metadata.highlights.length) manifest.highlights.push({
				source: file.path,
				ranges: metadata.highlights.map((range) => ({ ...range })),
			});
			manifest.annotations.push(...metadata.annotations.map((annotation) => ({
				...annotation,
				source: file.path,
			})));
			if (metadata.output) manifest.outputs.push({
				source: file.path,
				heading: metadata.output.heading || undefined,
				examples: metadata.output.examples.map((example) => ({ ...example })),
			});
		});
		return {
			name: this.state.name,
			files: this.state.files.map((file) => ({ ...file })),
			manifest,
			fence: {
				exercise: this.state.name,
				layout: this.state.layout,
				entrypoint: this.state.entrypoint || undefined,
				'word-wrap': this.state.wordWrap,
			},
		};
	}

	private renderNavigation() {
		const navigation = this.contentEl.createDiv('exerciser-wizard-navigation');
		const cancel = navigation.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => this.close());
		if (this.step > 0) {
			const back = navigation.createEl('button', { text: 'Back' });
			back.addEventListener('click', () => {
				this.step -= 1;
				this.render();
			});
		}
		const next = navigation.createEl('button', {
			text: this.step === 4 ? 'Create and insert' : 'Continue',
			cls: 'mod-cta',
		});
		next.addEventListener('click', () => {
			void (async () => {
				const error = this.validateStep();
				if (error) return void new Notice(error);
				if (this.step < 4) {
					this.step += 1;
					this.render();
					return;
				}
				next.disabled = true;
				try {
					await this.onCreate(this.buildSpec());
					this.close();
				} catch (failure) {
					next.disabled = false;
					new Notice(failure instanceof Error ? failure.message : String(failure));
				}
			})();
		});
	}
}
