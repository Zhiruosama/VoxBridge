export default function SpeechSpeed({
  value = 1,
  onChange,
}: {
  value?: number;
  onChange: (speed: number) => void;
}) {
  return (
    <div className="speech-speed-control">
      <input
        type="range"
        aria-label="语音生成速度"
        min={0.5}
        max={2}
        step={0.05}
        value={value}
        aria-valuetext={`${value.toFixed(2)} 倍`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{value.toFixed(2)}×</output>
    </div>
  );
}
