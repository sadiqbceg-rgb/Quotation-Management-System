import { Button } from '@/components/common/Button';

export interface TermOrderControlsProps {
  title: string;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: -1 | 1) => void;
}

/**
 * Up/down ordering for a selected term.
 *
 * Buttons rather than drag-and-drop as the primary control: the document
 * numbers terms positionally, so ordering has to be operable by keyboard and by
 * a screen reader, and a drag handle alone is neither.
 */
export function TermOrderControls({ title, isFirst, isLast, onMove }: TermOrderControlsProps) {
  return (
    <div className="flex shrink-0 flex-col">
      <Button
        variant="ghost"
        size="sm"
        disabled={isFirst}
        aria-label={`Move "${title}" up`}
        className="h-6 px-1.5"
        onClick={() => {
          onMove(-1);
        }}
      >
        <span aria-hidden="true">↑</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={isLast}
        aria-label={`Move "${title}" down`}
        className="h-6 px-1.5"
        onClick={() => {
          onMove(1);
        }}
      >
        <span aria-hidden="true">↓</span>
      </Button>
    </div>
  );
}
