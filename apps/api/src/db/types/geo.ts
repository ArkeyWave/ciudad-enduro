import { customType } from 'drizzle-orm/pg-core';

// Drizzle's native geometry() drops the type and the SRID. These columns carry both in the
// column typmod. They are write-only on the driver side: reads select ST_X/ST_Y or
// ST_AsGeoJSON(col)::json, never the raw driver value (hex EWKB).

export interface LngLat {
  lng: number;
  lat: number;
}

export const pointGeom = customType<{ data: LngLat; driverData: string }>({
  dataType: () => 'geometry(Point, 4326)',
  toDriver: ({ lng, lat }) => `SRID=4326;POINT(${lng} ${lat})`,
});

export const lineStringGeom = customType<{ data: [number, number][]; driverData: string }>({
  dataType: () => 'geometry(LineString, 4326)',
  toDriver: (coords) => `SRID=4326;LINESTRING(${coords.map(([lng, lat]) => `${lng} ${lat}`).join(', ')})`,
});

/** A point on the sphere (photo positions, plan §9 V4): distances in metres without a cast. */
export const pointGeog = customType<{ data: LngLat; driverData: string }>({
  dataType: () => 'geography(Point, 4326)',
  toDriver: ({ lng, lat }) => `SRID=4326;POINT(${lng} ${lat})`,
});
