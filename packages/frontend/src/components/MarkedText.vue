<script lang="ts">
import { defineComponent, h } from 'vue';
import { parseMarkedText } from '@/utils/render.ts';

export default defineComponent({
    name: 'MarkedText',
    props: {
        text: {
            type: String,
            default: undefined
        },
        fallback: {
            type: String,
            default: ''
        }
    },
    setup(props) {
        return () =>
            h(
                'span',
                parseMarkedText(props.text, props.fallback).map(segment =>
                    segment.marked ? h('mark', segment.text) : segment.text
                )
            );
    }
});
</script>
