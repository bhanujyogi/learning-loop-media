import type { InteractiveDefinition } from '@learning-loop/validation';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { track } from '../../lib/event-queue';
import { HIT, radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Button, Text } from '../../ui/primitives';

/**
 * Data-driven interactive renderer: definition (validated JSON) → rendering → student interaction → learning event.
 * New experiences are added by adding a `kind` here + in packages/validation, not by writing a new screen.
 */
export function InteractiveRenderer({
  contentId,
  def,
}: {
  contentId: string;
  def: InteractiveDefinition;
}) {
  const done = (score: number, durationMs: number) =>
    track('interaction_completed', {
      content_id: contentId,
      kind: def.kind,
      score,
      duration_ms: durationMs,
    });
  switch (def.kind) {
    case 'tap_reveal':
      return <TapReveal def={def} onDone={done} />;
    case 'ordering':
      return <Ordering def={def} onDone={done} />;
    case 'matching':
      return <Matching def={def} onDone={done} />;
    case 'timeline':
      return <Timeline def={def} />;
    case 'map':
      return <MapView def={def} onDone={done} />;
    case 'diagram':
      return (
        <Text muted>Diagram hotspots need the media pipeline (not configured in this build).</Text>
      );
  }
}

type Done = (score: number, durationMs: number) => void;

function TapReveal({
  def,
  onDone,
}: {
  def: Extract<InteractiveDefinition, { kind: 'tap_reveal' }>;
  onDone: Done;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [t0] = useState(Date.now());
  const { colors } = useTheme();
  const toggle = (id: string) => {
    const n = new Set(open);
    n.add(id);
    setOpen(n);
    if (n.size === def.items.length) onDone(1, Date.now() - t0);
  };
  return (
    <View style={{ gap: space.sm }}>
      {def.items.map((it) => (
        <Pressable
          key={it.id}
          accessibilityRole="button"
          accessibilityLabel={open.has(it.id) ? `${it.label}: ${it.reveal}` : `Reveal ${it.label}`}
          onPress={() => toggle(it.id)}
          style={{
            minHeight: HIT,
            padding: space.md,
            borderRadius: radius.md,
            backgroundColor: colors.surfaceAlt,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text variant="label">{it.label}</Text>
          {open.has(it.id) ? <Text>{it.reveal}</Text> : <Text muted>Tap to reveal</Text>}
        </Pressable>
      ))}
    </View>
  );
}

function Ordering({
  def,
  onDone,
}: {
  def: Extract<InteractiveDefinition, { kind: 'ordering' }>;
  onDone: Done;
}) {
  const shuffled = useMemo(() => [...def.items].sort((a, b) => a.id.localeCompare(b.id)), [def]);
  const [picked, setPicked] = useState<string[]>([]);
  const [result, setResult] = useState<boolean | null>(null);
  const [t0] = useState(Date.now());
  const label = (id: string) => def.items.find((i) => i.id === id)?.text ?? id;
  const check = () => {
    const ok = picked.every((p, i) => p === def.order[i]);
    setResult(ok);
    onDone(
      ok ? 1 : picked.filter((p, i) => p === def.order[i]).length / def.order.length,
      Date.now() - t0,
    );
  };
  return (
    <View style={{ gap: space.sm }}>
      <Text muted>Tap the items in the correct order.</Text>
      {shuffled.map((it) => (
        <Button
          key={it.id}
          variant={picked.includes(it.id) ? 'primary' : 'secondary'}
          disabled={picked.includes(it.id) || result !== null}
          label={picked.includes(it.id) ? `${picked.indexOf(it.id) + 1}. ${it.text}` : it.text}
          onPress={() => setPicked([...picked, it.id])}
        />
      ))}
      {picked.length === def.items.length && result === null ? (
        <Button label="Check order" onPress={check} />
      ) : null}
      {result !== null ? (
        <Text accessibilityLiveRegion="polite" variant="label">
          {result ? '✓ Correct order' : `✗ Not quite. Correct: ${def.order.map(label).join(' → ')}`}
        </Text>
      ) : null}
      {picked.length > 0 && result === null ? (
        <Button variant="ghost" label="Reset" onPress={() => setPicked([])} />
      ) : null}
    </View>
  );
}

function Matching({
  def,
  onDone,
}: {
  def: Extract<InteractiveDefinition, { kind: 'matching' }>;
  onDone: Done;
}) {
  const [left, setLeft] = useState<string | null>(null);
  const [pairs, setPairs] = useState<Record<string, string>>({});
  const [t0] = useState(Date.now());
  const pick = (r: string) => {
    if (!left) return;
    const next = { ...pairs, [left]: r };
    setPairs(next);
    setLeft(null);
    if (Object.keys(next).length === def.pairs.length) {
      const ok = def.pairs.filter((p) => next[p.left] === p.right).length;
      onDone(ok / def.pairs.length, Date.now() - t0);
    }
  };
  const complete = Object.keys(pairs).length === def.pairs.length;
  return (
    <View style={{ gap: space.sm }}>
      <Text muted>Tap an item on the left, then its match.</Text>
      {def.left.map((l) => (
        <Button
          key={l.id}
          variant={left === l.id ? 'primary' : 'secondary'}
          label={`${l.text}${pairs[l.id] ? ' → ' + (def.right.find((r) => r.id === pairs[l.id])?.text ?? '') : ''}`}
          onPress={() => setLeft(l.id)}
          disabled={complete}
        />
      ))}
      <View style={{ height: space.sm }} />
      {def.right.map((r) => (
        <Button
          key={r.id}
          variant="secondary"
          label={r.text}
          onPress={() => pick(r.id)}
          disabled={!left}
        />
      ))}
      {complete ? (
        <Text accessibilityLiveRegion="polite" variant="label">
          {def.pairs.filter((p) => pairs[p.left] === p.right).length} of {def.pairs.length} correct
        </Text>
      ) : null}
    </View>
  );
}

function Timeline({ def }: { def: Extract<InteractiveDefinition, { kind: 'timeline' }> }) {
  const events = [...def.events].sort((a, b) => a.year - b.year);
  return (
    <ScrollView style={{ maxHeight: 360 }}>
      {events.map((e) => (
        <View
          key={e.id}
          style={{ flexDirection: 'row', gap: space.md, paddingVertical: space.sm }}
          accessible
          accessibilityLabel={`${e.year}: ${e.label}`}
        >
          <Text variant="label" style={{ width: 56 }}>
            {e.year}
          </Text>
          <View style={{ flex: 1 }}>
            <Text variant="label">{e.label}</Text>
            {e.detail ? <Text muted>{e.detail}</Text> : null}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

/** Vector map: regions are educational objects (tap → name/capital/info), drawn with react-native-svg paths. */
function MapView({
  def,
  onDone,
}: {
  def: Extract<InteractiveDefinition, { kind: 'map' }>;
  onDone: Done;
}) {
  const { colors } = useTheme();
  const [sel, setSel] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [t0] = useState(Date.now());
  const region = def.regions.find((r) => r.id === sel);
  const select = (id: string) => {
    setSel(id);
    const n = new Set(seen);
    n.add(id);
    setSeen(n);
    if (n.size === def.regions.length) onDone(1, Date.now() - t0);
  };
  return (
    <View style={{ gap: space.md }}>
      <Svg
        viewBox={def.viewBox.join(' ')}
        width="100%"
        height={260}
        accessibilityLabel="Interactive map"
      >
        {def.regions.map((r) => (
          <Path
            key={r.id}
            d={r.path}
            fill={r.id === sel ? colors.primary : colors.surfaceAlt}
            stroke={colors.text}
            strokeWidth={1}
            onPress={() => select(r.id)}
            accessibilityLabel={r.name}
          />
        ))}
      </Svg>
      <Text accessibilityLiveRegion="polite" variant="label">
        {region
          ? `${region.name}${region.capital ? ' — capital: ' + region.capital : ''}`
          : 'Tap a region'}
      </Text>
      {region?.info ? <Text muted>{region.info}</Text> : null}
    </View>
  );
}
