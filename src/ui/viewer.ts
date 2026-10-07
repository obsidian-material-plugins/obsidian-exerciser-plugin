import {
	App,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	sanitizeHTMLToDom,
	setIcon,
	TFile,
} from 'obsidian';
import type { ExerciseFenceConfig, ExerciseOutputExample, ViewerFile } from '../types';
import { loadExercise, type LoadedExercise, viewerKindForExtension } from '../vault-service';
import { ComparisonModal } from './comparison';
import { TextPromptModal } from './modals';

interface PrismApi {
	languages: Record<string, unknown>;
	highlight(source: string, grammar: unknown, language: string): string;
}

declare global {
	interface Window {
		Prism?: PrismApi;
	}
}

export interface ViewerHost {
	app: App;
	startCopy(exercise: string): Promise<void>;
	createMissingExercise(exercise: string): Promise<void>;
}

const languageByExtension: Record<string, string> = {
	c: 'c',
	cc: 'cpp',
	cpp: 'cpp',
	cs: 'csharp',
	css: 'css',
	go: 'go',
	h: 'c',
	hpp: 'cpp',
	html: 'markup',
	java: 'java',
	js: 'javascript',
	json: 'json',
	kt: 'kotlin',
	md: 'markdown',
	php: 'php',
	py: 'python',
	rb: 'ruby',
	rs: 'rust',
	sh: 'bash',
	sql: 'sql',
	ts: 'typescript',
	tsx: 'tsx',
	xml: 'markup',
	yaml: 'yaml',
	yml: 'yaml',
};

const formatBytes = (size: number) => {
	if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1)} MB`;
	if (size >= 1024) return `${Math.round(size / 1024)} KB`;
	return `${size} B`;
};

const renderHighlightedCode = (
	target: HTMLElement,
	file: ViewerFile,
	exercise: LoadedExercise,
) => {
	const source = file.content ?? '';
	const language = languageByExtension[file.extension] ?? 'plain';
	const grammar = window.Prism?.languages[language];
	const highlight = exercise.manifest.highlights.find((item) => item.source === file.path);
	const annotations = exercise.manifest.annotations.filter((item) => item.source === file.path);
	const lines = source.split('\n');
	const pre = target.createEl('pre', { cls: 'exerciser-source' });
	lines.forEach((line, index) => {
		const number = index + 1;
		const row = pre.createDiv('exerciser-source-line');
		row.createSpan({ cls: 'exerciser-line-number', text: String(number) });
		const code = row.createEl('code');
		if (grammar && window.Prism) {
			code.append(sanitizeHTMLToDom(window.Prism.highlight(line || ' ', grammar, language)));
		}
		else code.textContent = line || ' ';
		if (highlight) {
			row.addClass('is-dim');
			for (const range of highlight.ranges) {
				const [start, end = start] = range.lines.split('-').map(Number);
				if (number >= start! && number <= end!) {
					row.removeClass('is-dim');
					row.addClass('is-highlighted');
					if (range.accent) row.style.setProperty('--exerciser-accent', range.accent);
				}
			}
		}
		if (annotations.some((item) => item.line === number)) {
			row.addClass('is-annotated');
			const marker = row.createSpan({ cls: 'exerciser-line-annotation', text: 'ⓘ' });
			marker.setAttribute(
				'aria-label',
				annotations.find((item) => item.line === number)?.text ?? 'Annotation',
			);
		}
	});
};

const renderMedia = (target: HTMLElement, file: ViewerFile) => {
	const media = target.createDiv('exerciser-media');
	if (file.kind === 'image') {
		media.createEl('img', { attr: { src: file.resourceUrl ?? '', alt: file.name } });
	} else if (file.kind === 'audio') {
		media.createEl('audio', { attr: { src: file.resourceUrl ?? '', controls: 'true' } });
	} else if (file.kind === 'video') {
		media.createEl('video', {
			attr: { src: file.resourceUrl ?? '', controls: 'true', preload: 'metadata' },
		});
	} else if (file.kind === 'pdf') {
		media.createEl('iframe', {
			attr: { src: file.resourceUrl ?? '', title: file.name },
		});
	} else {
		media.createEl('strong', { text: file.name });
		media.createEl('p', {
			text:
				file.kind === 'oversized'
					? 'This file exceeds the configured preview limit.'
					: 'Preview unavailable',
		});
		media.createEl('p', {
			cls: 'exerciser-muted',
			text: `File type: ${file.extension || 'unknown'} · File size: ${formatBytes(file.size)}`,
		});
		if (file.resourceUrl) {
			media.createEl('a', {
				cls: 'mod-cta',
				text: 'Download file',
				href: file.resourceUrl,
				attr: { download: file.name },
			});
		}
	}
};

const renderTree = (
	target: HTMLElement,
	files: ViewerFile[],
	onSelect: (path: string) => void,
) => {
	interface Branch {
		[name: string]: Branch | ViewerFile;
	}
	const tree: Branch = {};
	for (const file of files) {
		let cursor = tree;
		const parts = file.path.split('/');
		parts.forEach((part, index) => {
			if (index === parts.length - 1) cursor[part] = file;
			else {
				cursor[part] ??= {};
				cursor = cursor[part] as Branch;
			}
		});
	}
	const branch = (container: HTMLElement, value: Branch) => {
		const list = container.createEl('ul');
		Object.keys(value)
			.sort()
			.forEach((name) => {
				const item = list.createEl('li');
				const child = value[name]!;
				if (typeof (child as ViewerFile).path === 'string') {
					const file = child as ViewerFile;
					const button = item.createEl('button', { text: name });
					button.dataset.path = file.path;
					button.addEventListener('click', () => onSelect(file.path));
				} else {
					const details = item.createEl('details', { attr: { open: 'true' } });
					details.createEl('summary', { text: name });
					branch(details, child as Branch);
				}
			});
	};
	branch(target, tree);
};

class ExerciseViewerChild extends MarkdownRenderChild {
	private exercise: LoadedExercise | null = null;
	private selected = '';
	private openTabs: string[] = [];
	private raw = false;
	private wrap: boolean;

	constructor(
		container: HTMLElement,
		private readonly host: ViewerHost,
		private readonly fence: ExerciseFenceConfig,
	) {
		super(container);
		this.wrap = fence['word-wrap'];
	}

	onload() {
		void this.render();
	}

	private async render() {
		this.containerEl.empty();
		this.containerEl.addClass('obsidian-exerciser-viewer', `layout-${this.fence.layout}`);
		this.exercise = await loadExercise(this.host.app, this.fence.exercise);
		if (!this.exercise) {
			const state = this.containerEl.createDiv('exerciser-state');
			state.createEl('p', { text: 'Exercise folder not found.' });
			const create = state.createEl('button', { text: 'Create exercise', cls: 'mod-cta' });
			create.addEventListener('click', () => {
				void this.host.createMissingExercise(this.fence.exercise).then(() => this.render());
			});
			return;
		}
		if (!this.exercise.files.length) {
			this.renderEmpty();
			return;
		}
		this.selected =
			(this.fence.entrypoint &&
				this.exercise.files.some((file) => file.path === this.fence.entrypoint) &&
				this.fence.entrypoint) ||
			this.exercise.files[0]!.path;
		this.openTabs = [this.selected];
		this.renderViewer();
	}

	private renderEmpty() {
		const state = this.containerEl.createDiv('exerciser-state');
		state.createEl('strong', { text: 'This exercise is empty' });
		state.createEl('p', { text: 'Add the first file or folder.' });
		const actions = state.createDiv('exerciser-empty-actions');
		const createFile = actions.createEl('button', { text: 'Create file' });
		createFile.addEventListener('click', () =>
			new TextPromptModal(this.host.app, 'Create file', 'Main.java', 'Create', async (name) => {
				await this.host.app.vault.create(`${this.exercise!.root}/${name}`, '');
				await this.render();
			}).open(),
		);
		const createFolder = actions.createEl('button', { text: 'Create folder' });
		createFolder.addEventListener('click', () =>
			new TextPromptModal(this.host.app, 'Create folder', 'src', 'Create', async (name) => {
				await this.host.app.vault.createFolder(`${this.exercise!.root}/${name}`);
				await this.render();
			}).open(),
		);
		const importButton = actions.createEl('button', { text: 'Import' });
		const input = actions.createEl('input', { type: 'file', attr: { multiple: 'true' } });
		input.addClass('exerciser-file-input');
		importButton.addEventListener('click', () => input.click());
		input.addEventListener('change', () => {
			void (async () => {
				for (const file of Array.from(input.files ?? [])) {
					await this.host.app.vault.createBinary(
						`${this.exercise!.root}/${file.name}`,
						await file.arrayBuffer(),
					);
				}
				await this.render();
			})();
		});
		['Copy', 'Move', 'Delete'].forEach((label) => {
			const button = actions.createEl('button', { text: label });
			button.disabled = true;
			button.title = 'Select a file first';
		});
	}

	private renderViewer() {
		const titlebar = this.containerEl.createDiv('exerciser-titlebar');
		titlebar.createEl('code', { text: this.exercise!.name });
		const copy = titlebar.createEl('button', { text: 'Copy exercise', cls: 'mod-cta' });
		setIcon(copy, 'copy');
		copy.addEventListener('click', () => void this.host.startCopy(this.exercise!.name));
		const shell = this.containerEl.createDiv('exerciser-shell');
		const tree = shell.createEl('aside', { cls: 'exerciser-tree' });
		tree.createEl('strong', { text: this.exercise!.name });
		renderTree(tree.createDiv(), this.exercise!.files, (file) => this.select(file));
		const main = shell.createDiv('exerciser-main');
		main.createDiv('exerciser-tabs');
		const selector = main.createEl('select', { cls: 'exerciser-selector' });
		this.exercise!.files.forEach((file) => selector.createEl('option', { text: file.path, value: file.path }));
		selector.addEventListener('change', () => this.select(selector.value));
		main.createDiv('exerciser-preview-header');
		main.createDiv('exerciser-preview');
		main.createDiv('exerciser-notes');
		main.createDiv('exerciser-output');
		this.update();
	}

	private select(file: string) {
		this.selected = file;
		if (!this.openTabs.includes(file)) this.openTabs.push(file);
		this.update();
	}

	private update() {
		if (!this.exercise) return;
		const file = this.exercise.files.find((item) => item.path === this.selected);
		if (!file) return;
		this.containerEl.toggleClass('is-wrapped', this.wrap);
		this.containerEl.toggleClass('is-raw', this.raw);
		const tabs = this.containerEl.querySelector<HTMLElement>('.exerciser-tabs')!;
		tabs.empty();
		for (const path of this.openTabs) {
			const tabFile = this.exercise.files.find((item) => item.path === path);
			const tab = tabs.createEl('button', { text: tabFile?.name ?? path });
			tab.toggleClass('is-active', path === this.selected);
			tab.addEventListener('click', () => this.select(path));
			const close = tab.createSpan({ text: '×' });
			close.addEventListener('click', (event) => {
				event.stopPropagation();
				if (this.openTabs.length === 1) return;
				const index = this.openTabs.indexOf(path);
				this.openTabs.splice(index, 1);
				if (this.selected === path) this.selected = this.openTabs[Math.max(0, index - 1)]!;
				this.update();
			});
		}
		const selector = this.containerEl.querySelector<HTMLSelectElement>('.exerciser-selector')!;
		selector.value = this.selected;
		const header = this.containerEl.querySelector<HTMLElement>('.exerciser-preview-header')!;
		header.empty();
		header.createEl('code', { text: file.path });
		const toolbar = header.createDiv('exerciser-toolbar');
		this.toolbarButton(toolbar, 'copy', 'Copy file contents', async () => {
			if (file.content !== undefined) await navigator.clipboard.writeText(file.content);
		});
		this.toolbarButton(toolbar, 'download', 'Download this file', () => {
			if (file.resourceUrl) window.open(file.resourceUrl);
			else if (file.content !== undefined) {
				const link = document.body.createEl('a');
				link.href = URL.createObjectURL(new Blob([file.content], { type: 'text/plain' }));
				link.download = file.name;
				link.click();
				URL.revokeObjectURL(link.href);
				link.remove();
			}
		});
		this.toolbarButton(toolbar, 'wrap-text', 'Toggle word wrap', () => {
			this.wrap = !this.wrap;
			this.update();
		});
		this.toolbarButton(toolbar, 'code-2', 'Toggle raw view', () => {
			this.raw = !this.raw;
			this.update();
		});
		const preview = this.containerEl.querySelector<HTMLElement>('.exerciser-preview')!;
		preview.empty();
		if (file.kind === 'text') {
			if (this.raw) preview.createEl('pre', { cls: 'exerciser-raw', text: file.content ?? '' });
			else renderHighlightedCode(preview, file, this.exercise);
		} else renderMedia(preview, file);
		this.renderNotes();
		void this.renderOutput();
		this.containerEl.querySelectorAll<HTMLElement>('.exerciser-tree button').forEach((button) =>
			button.toggleClass('is-active', button.dataset.path === this.selected),
		);
	}

	private toolbarButton(container: HTMLElement, icon: string, label: string, action: () => void | Promise<void>) {
		const button = container.createEl('button', { attr: { 'aria-label': label, title: label } });
		setIcon(button, icon);
		button.addEventListener('click', () => void action());
	}

	private renderNotes() {
		const target = this.containerEl.querySelector<HTMLElement>('.exerciser-notes')!;
		target.empty();
		this.exercise!.manifest.annotations
			.filter((item) => item.source === this.selected)
			.forEach((item) => target.createEl('p', { text: `ⓘ L${item.line} · ${item.text}` }));
		const highlight = this.exercise!.manifest.highlights.find((item) => item.source === this.selected);
		highlight?.ranges.forEach((range, index) => {
			if (!range.note) return;
			const note = target.createEl('p', {
				text: `${String.fromCodePoint(0x2460 + index)} Lines ${range.lines} · ${range.note}`,
			});
			if (range.accent) note.style.color = range.accent;
		});
		target.toggleClass('is-empty', !target.childElementCount);
	}

	private async outputContent(example: ExerciseOutputExample) {
		if (example['content-file']) {
			try {
				return await this.host.app.vault.adapter.read(
					`${this.exercise!.root}/${example['content-file']}`,
				);
			} catch {
				return example.fallback ?? '';
			}
		}
		return example.content ?? example.fallback ?? '';
	}

	private async renderOutput() {
		const target = this.containerEl.querySelector<HTMLElement>('.exerciser-output')!;
		target.empty();
		const association = this.exercise!.manifest.outputs.find((item) => item.source === this.selected);
		target.toggleClass('is-empty', !association);
		if (!association) return;
		let active = 0;
		const render = async () => {
			target.empty();
			const header = target.createDiv('exerciser-output-heading');
			header.createEl('strong', { text: association.heading ?? 'Expected output' });
			const help = header.createEl('button', { text: '?', attr: { title: '○ stdout — ordinary output\n› stdin — user input\n! Stderr — error output' } });
			help.setAttribute('aria-label', 'Terminal marker help');
			const compare = header.createEl('button', { text: 'Compare output' });
			setIcon(compare, 'columns-2');
			const example = association.examples[active]!;
			const content = await this.outputContent(example);
			compare.addEventListener('click', () => new ComparisonModal(this.host.app, content).open());
			if (association.examples.length > 1) {
				const tabs = target.createDiv('exerciser-output-tabs');
				association.examples.forEach((item, index) => {
					const tab = tabs.createEl('button', { text: item.label ?? `Example ${index + 1}` });
					tab.toggleClass('is-active', index === active);
					tab.addEventListener('click', () => {
						active = index;
						void render();
					});
				});
			}
			target.createEl('code', { cls: 'exerciser-output-path', text: association.source });
			if (example.type === 'file' && example.file) {
				const abstract = this.host.app.vault.getAbstractFileByPath(`${this.exercise!.root}/${example.file}`);
				if (abstract instanceof TFile) {
					renderMedia(target, {
						path: example.file,
						name: abstract.name,
						size: abstract.stat.size,
						extension: abstract.extension,
						kind: viewerKindForExtension(abstract.extension),
						resourceUrl: this.host.app.vault.getResourcePath(abstract),
					});
				} else if (example.fallback) target.createEl('pre', { text: example.fallback });
			} else {
				const terminal = target.createEl('pre', { cls: `exerciser-terminal type-${example.type}` });
				content.split('\n').forEach((line) => {
					const marker = /^\[(stdout|stdin|stderr)\]\s?/.exec(line);
					const stream = marker?.[1] ?? (example.type === 'stderr' ? 'stderr' : 'stdout');
					terminal.createSpan({
						cls: `stream-${stream}`,
						text: `${stream === 'stdin' ? '› stdin  ' : stream === 'stderr' ? '! stderr ' : '○ stdout '}${line.replace(/^\[(stdout|stdin|stderr)\]\s?/, '')}\n`,
					});
				});
			}
		};
		await render();
	}
}

export const registerExerciseBlock = (
	host: ViewerHost,
	source: string,
	element: HTMLElement,
	context: MarkdownPostProcessorContext,
	parse: (source: string) => ExerciseFenceConfig | null,
) => {
	const fence = parse(source);
	if (!fence) {
		element.createDiv({ cls: 'exerciser-state', text: 'Invalid exercise path' });
		return;
	}
	context.addChild(new ExerciseViewerChild(element, host, fence));
};
