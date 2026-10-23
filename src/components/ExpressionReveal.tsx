import { useMemo, type CSSProperties } from 'react';

/** Visual reveal only: full text is available immediately to selection and assistive tools. */
export default function ExpressionReveal({ text }: { text: string }) {
  const words = useMemo(() => {
    const parts = Array.from(
      new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text),
      (part) => part.segment,
    );
    const stride = Math.max(1, Math.ceil(parts.length / 100));
    const chunks: string[] = [];
    for (let index = 0; index < parts.length; index += stride)
      chunks.push(parts.slice(index, index + stride).join(''));
    return chunks;
  }, [text]);
  return (
    <span className="expression-reveal" key={text}>
      {words.map((word, index) => (
        <span
          className="expression-word"
          key={index}
          style={
            {
              '--reveal-delay': `${index * Math.min(24, 550 / Math.max(1, words.length - 1))}ms`,
            } as CSSProperties
          }
        >
          {word}
        </span>
      ))}
    </span>
  );
}
