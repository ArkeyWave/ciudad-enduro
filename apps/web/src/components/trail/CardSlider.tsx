'use client';

import type { Coordinates, PreviewPhoto } from 'api-client';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { autoAdvance } from '../../lib/auto-advance';
import { OSM_COPYRIGHT_URL, tileMosaic } from '../../lib/osm';

/** The screen-centre band the card centre must reach before the auto-advance (plan §10 L3-8). */
const BAND = '0px';

/**
 * The Explorar card slider (plan §10.1 A13, A14): slide 1 is a static map of the trail start, then
 * its photos. It sits above the card's stretched title link, so a tap on it never opens the trail.
 * 3 s after the card centre reaches the screen centre it moves once to the first photo; any rider
 * input on it, or reduced motion, turns that off.
 */
export function CardSlider({ name, start, photos }: { name: string; start: Coordinates; photos: PreviewPhoto[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLSpanElement>(null);
  const stop = useRef(() => {});
  const [active, setActive] = useState(0);
  const map = tileMosaic(start);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !sentinel.current || photos.length === 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const slider = autoAdvance(() => el.scrollTo({ left: el.clientWidth }));
    const cancel = () => slider.stop();
    stop.current = cancel;
    const observer = new IntersectionObserver(([entry]) => slider.band(entry?.isIntersecting ?? false), { rootMargin: BAND });
    observer.observe(sentinel.current);
    // A tap does not focus the slider on every browser, so pointerdown is listened to as well.
    const inputs = ['pointerdown', 'scroll', 'focusin'] as const;
    for (const type of inputs) el.addEventListener(type, cancel, { passive: true });
    return () => {
      observer.disconnect();
      for (const type of inputs) el.removeEventListener(type, cancel);
      slider.stop();
    };
  }, [photos.length]);

  const go = (index: number) => {
    stop.current();
    scroller.current?.scrollTo({ left: index * scroller.current.clientWidth });
  };

  return (
    <>
      <span ref={sentinel} className="card-centre" aria-hidden="true" />
      <div className="slider">
        <div
          ref={scroller}
          className="slides"
          role="region"
          tabIndex={0}
          aria-label={`Mapa y vistas de ${name}`}
          onScroll={(e) => setActive(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        >
          <div className="slide map-slide">
            <div className="tile-mosaic" style={{ '--x': map.x, '--y': map.y } as CSSProperties}>
              {map.tiles.map((src) => (
                <img key={src} src={src} alt="" width={256} height={256} loading="lazy" />
              ))}
              <span className="start-dot" aria-hidden="true" />
            </div>
            <span className="slide-credit">
              © <a href={OSM_COPYRIGHT_URL}>OpenStreetMap</a>
            </span>
          </div>
          {photos.map((photo, i) => (
            <div key={photo.url} className="slide">
              <img
                src={photo.url}
                srcSet={`${photo.url} 1600w`}
                sizes="(min-width: 720px) 720px, 100vw"
                alt={`Vista ${i + 1} de ${name}`}
                loading="lazy"
              />
            </div>
          ))}
        </div>
        {photos.length > 0 && (
          <div className="dots">
            {['Mapa', ...photos.map((_, i) => `Vista ${i + 1} de ${photos.length}`)].map((label, i) => (
              <button
                key={label}
                type="button"
                className="dot"
                aria-label={label}
                aria-current={i === active ? 'true' : undefined}
                onClick={() => go(i)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
