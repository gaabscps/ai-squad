import { sparkline } from '../components/sparkline';

describe('sparkline', () => {
  it('returns empty string for empty array', () => {
    expect(sparkline([])).toBe('');
  });

  it('returns empty string for single value', () => {
    expect(sparkline([42])).toBe('');
  });

  it('generates SVG with 4 points for 4 values', () => {
    const svg = sparkline([1, 2, 3, 4]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('<polyline');
    // 4 points means 4 coordinate pairs separated by spaces
    const pointsMatch = svg.match(/points="([^"]+)"/);
    expect(pointsMatch).not.toBeNull();
    const points = pointsMatch![1].trim().split(/\s+/);
    expect(points).toHaveLength(4);
  });

  it('uses currentColor for stroke to inherit context', () => {
    const svg = sparkline([1, 2]);
    expect(svg).toContain('stroke="currentColor"');
  });

  it('viewBox matches width and height', () => {
    const svg = sparkline([1, 2], 60, 20);
    expect(svg).toContain('viewBox="0 0 60 20"');
    expect(svg).toContain('width="60"');
    expect(svg).toContain('height="20"');
  });

  it('has aria-label for accessibility', () => {
    const svg = sparkline([1, 2]);
    expect(svg).toContain('aria-label="trend"');
  });

  it('uses custom width and height', () => {
    const svg = sparkline([10, 20], 80, 30);
    expect(svg).toContain('width="80"');
    expect(svg).toContain('height="30"');
    expect(svg).toContain('viewBox="0 0 80 30"');
  });

  it('handles all-equal values without division-by-zero', () => {
    const svg = sparkline([5, 5, 5]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('points=');
  });

  it('generates 2 points for 2 values', () => {
    const svg = sparkline([0, 100]);
    const pointsMatch = svg.match(/points="([^"]+)"/);
    expect(pointsMatch).not.toBeNull();
    const points = pointsMatch![1].trim().split(/\s+/);
    expect(points).toHaveLength(2);
  });

  it('first point x is 0.0', () => {
    const svg = sparkline([1, 2, 3]);
    const pointsMatch = svg.match(/points="([^"]+)"/);
    const firstPoint = pointsMatch![1].trim().split(/\s+/)[0];
    expect(firstPoint.startsWith('0.0,')).toBe(true);
  });

  it('last point x equals width', () => {
    const svg = sparkline([1, 2, 3], 60, 20);
    const pointsMatch = svg.match(/points="([^"]+)"/);
    const points = pointsMatch![1].trim().split(/\s+/);
    const lastPoint = points[points.length - 1];
    const lastX = parseFloat(lastPoint.split(',')[0]);
    expect(lastX).toBeCloseTo(60, 1);
  });
});
