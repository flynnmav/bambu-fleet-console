interface Props {
  value: number;
  paused?: boolean;
}

export function ProgressRing({ value, paused = false }: Props) {
  const radius = 43;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(100, Math.max(0, value));
  return (
    <div className={`progress-ring ${paused ? 'is-paused' : ''}`} aria-label={`打印进度 ${progress}%`}>
      <svg viewBox="0 0 104 104" aria-hidden="true">
        <circle className="ring-track" cx="52" cy="52" r={radius} />
        <circle
          className="ring-value"
          cx="52"
          cy="52"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress / 100)}
        />
      </svg>
      <div className="ring-label"><strong>{Math.round(progress)}<span>%</span></strong><small>{paused ? '已暂停' : '已完成'}</small></div>
    </div>
  );
}
