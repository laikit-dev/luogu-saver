<script setup lang="ts">
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
    HighlightStyle,
    bracketMatching,
    defaultHighlightStyle,
    foldGutter,
    indentOnInput,
    syntaxHighlighting
} from '@codemirror/language';
import { html } from '@codemirror/lang-html';
import { tags } from '@lezer/highlight';
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { uiThemeKey, type CodeTheme } from '@/styles/theme/themeKeys.ts';

const props = defineProps<{
    value: string;
    readonly?: boolean;
}>();

const emit = defineEmits<{
    'update:value': [value: string];
}>();

const uiTheme = inject(uiThemeKey, null);
const codeTheme = computed<CodeTheme>(() => uiTheme?.value.codeTheme ?? 'light');

const editorHost = ref<HTMLElement | null>(null);
let editorView: EditorView | null = null;
let syncingFromEditor = false;
const codeThemeCompartment = new Compartment();

// Mirrors the Shiki `github-light` surface; fixed colors on purpose, because the light code theme
// can be paired with a dark UI, where UI surface tokens would put light-theme syntax colors on a
// dark background.
const lightCodeTheme: Extension = [
    syntaxHighlighting(defaultHighlightStyle),
    EditorView.theme(
        {
            '&': {
                backgroundColor: '#ffffff',
                color: '#24292e'
            },
            '.cm-gutters': {
                backgroundColor: '#f6f8fa',
                color: '#6a737d',
                borderRight: '1px solid #e1e4e8'
            },
            '.cm-activeLine': {
                backgroundColor: '#f6f8fa'
            },
            '.cm-activeLineGutter': {
                backgroundColor: '#eaeef2',
                color: '#24292e'
            },
            '.cm-cursor, .cm-dropCursor': {
                borderLeftColor: '#24292e'
            }
        },
        { dark: false }
    )
];

// Mirrors the Shiki `github-dark` theme that Markdown code blocks use for the dark code theme,
// so the editor stays readable even when the dark code theme is paired with a light UI.
const darkCodeTheme: Extension = [
    syntaxHighlighting(
        HighlightStyle.define([
            { tag: [tags.comment, tags.meta, tags.documentMeta], color: '#6a737d' },
            { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: '#f97583' },
            { tag: [tags.tagName, tags.angleBracket], color: '#85e89d' },
            { tag: [tags.attributeName, tags.propertyName], color: '#b392f0' },
            { tag: [tags.string, tags.attributeValue, tags.character], color: '#9ecbff' },
            {
                tag: [tags.atom, tags.bool, tags.number, tags.null, tags.unit, tags.url],
                color: '#79b8ff'
            },
            { tag: [tags.regexp, tags.escape], color: '#dbedff' },
            { tag: [tags.className, tags.typeName], color: '#b392f0' },
            { tag: tags.variableName, color: '#ffab70' },
            { tag: tags.processingInstruction, color: '#79b8ff' },
            { tag: tags.heading, color: '#79b8ff', fontWeight: 'bold' },
            { tag: tags.link, textDecoration: 'underline' },
            { tag: tags.emphasis, fontStyle: 'italic' },
            { tag: tags.strong, fontWeight: 'bold' },
            { tag: tags.invalid, color: '#fdaeb7' }
        ])
    ),
    EditorView.theme(
        {
            '&': {
                backgroundColor: '#24292e',
                color: '#e1e4e8'
            },
            '.cm-gutters': {
                backgroundColor: '#24292e',
                color: '#6a737d',
                borderRight: '1px solid #2f363d'
            },
            '.cm-activeLine': {
                backgroundColor: '#2b3036'
            },
            '.cm-activeLineGutter': {
                backgroundColor: '#2b3036',
                color: '#e1e4e8'
            },
            '.cm-cursor, .cm-dropCursor': {
                borderLeftColor: '#c8e1ff'
            },
            '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
                {
                    backgroundColor: '#3392ff44'
                }
        },
        { dark: true }
    )
];

function codeThemeExtension(theme: CodeTheme): Extension {
    return theme === 'dark' ? darkCodeTheme : lightCodeTheme;
}

const buildState = (value: string) =>
    EditorState.create({
        doc: value,
        extensions: [
            lineNumbers(),
            foldGutter(),
            history(),
            indentOnInput(),
            bracketMatching(),
            html(),
            codeThemeCompartment.of(codeThemeExtension(codeTheme.value)),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            EditorView.lineWrapping,
            EditorView.editable.of(!props.readonly),
            EditorView.updateListener.of(update => {
                if (!update.docChanged) return;
                syncingFromEditor = true;
                emit('update:value', update.state.doc.toString());
                syncingFromEditor = false;
            }),
            EditorView.theme({
                '&': {
                    minHeight: '320px',
                    borderRadius: 'var(--ui-card-radius)',
                    border: '1px solid var(--ui-border-color)',
                    fontSize: '14px'
                },
                '.cm-scroller': {
                    minHeight: '320px',
                    fontFamily: 'Fira Code, Consolas, monospace'
                },
                '.cm-content': {
                    padding: '12px 0'
                }
            })
        ]
    });

onMounted(() => {
    if (!editorHost.value) return;
    editorView = new EditorView({
        state: buildState(props.value),
        parent: editorHost.value
    });
});

watch(
    () => props.value,
    value => {
        if (!editorView || syncingFromEditor || value === editorView.state.doc.toString()) return;
        editorView.dispatch({
            changes: {
                from: 0,
                to: editorView.state.doc.length,
                insert: value
            }
        });
    }
);

watch(codeTheme, theme => {
    editorView?.dispatch({
        effects: codeThemeCompartment.reconfigure(codeThemeExtension(theme))
    });
});

onBeforeUnmount(() => {
    editorView?.destroy();
    editorView = null;
});
</script>

<template>
    <div ref="editorHost" class="html-code-editor"></div>
</template>

<style scoped>
.html-code-editor {
    overflow: hidden;
    border-radius: var(--ui-card-radius);
}
</style>
