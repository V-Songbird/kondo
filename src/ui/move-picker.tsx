import { useState } from 'react'

/** A place something can be moved to: whatever the caller's own list holds. */
interface Target {
  id: string
  label: string
}

/**
 * A destination picker that asks before it moves anything.
 *
 * The select used to mutate the store from its own `onChange`, which made one
 * Down keypress on a focused closed select a file move — the picker was the
 * whole of the decision, and a keyboard user never chose to make it. Choosing
 * a destination now only *stages* it: the select swaps for the same two-step
 * band the tidy sweep uses, naming both the thing and where it is going, and
 * nothing is written until that second, deliberate click.
 *
 * Cancelling puts the empty select back, so a choice waved off leaves no
 * residue and the row reads exactly as it did before.
 */
export function MovePicker({
  name,
  destinations,
  disabled,
  title,
  onMove
}: {
  /** What is being moved, as it reads in the question. */
  name: string
  destinations: readonly Target[]
  disabled: boolean
  title?: string
  onMove: (destinationId: string) => void
}) {
  const [staged, setStaged] = useState<Target | null>(null)

  if (staged !== null) {
    return (
      <div className="band band-pencil">
        <span>
          Move {name} to {staged.label}?
        </span>
        <button
          type="button"
          className="btn btn-pencil btn-sm"
          onClick={() => {
            setStaged(null)
            onMove(staged.id)
          }}
        >
          Move
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setStaged(null)}>
          Cancel
        </button>
      </div>
    )
  }

  return (
    <span className="pick">
      <select
        value=""
        disabled={disabled}
        title={title}
        onChange={(event) => {
          const target = destinations.find((candidate) => candidate.id === event.target.value)
          if (target !== undefined) setStaged(target)
        }}
      >
        <option value="">Move to&hellip;</option>
        {destinations.map((destination) => (
          <option key={destination.id} value={destination.id}>
            {destination.label}
          </option>
        ))}
      </select>
    </span>
  )
}
