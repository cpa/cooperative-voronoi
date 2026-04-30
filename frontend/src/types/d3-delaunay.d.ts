declare module "d3-delaunay" {
  export class Delaunay<T> {
    static from<T>(
      data: Iterable<T> | ArrayLike<T>,
      fx?: (datum: T, index: number) => number,
      fy?: (datum: T, index: number) => number
    ): Delaunay<T>;

    voronoi(bounds: [number, number, number, number]): Voronoi<T>;
    neighbors(index: number): Iterable<number>;
  }

  export class Voronoi<T> {
    cellPolygon(index: number): Array<[number, number]> | null;
  }
}
