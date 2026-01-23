// PartitionsDistribution.js - Euclidean distribution utilities for Partitions

class PartitionsDistribution {
    static generateEuclideanPattern(steps, pulses) {
        const stepCount = Math.max(1, Math.floor(Number(steps) || 1));
        const pulseCount = Math.max(0, Math.floor(Number(pulses) || 0));

        if (pulseCount === 0) return new Array(stepCount).fill(0);
        if (pulseCount >= stepCount) return new Array(stepCount).fill(1);

        const pattern = [];
        const counts = [];
        const remainders = [];

        let divisor = stepCount - pulseCount;
        remainders.push(pulseCount);
        let level = 0;

        while (true) {
            counts.push(Math.floor(divisor / remainders[level]));
            remainders.push(divisor % remainders[level]);
            divisor = remainders[level];
            level += 1;
            if (remainders[level] <= 1) {
                break;
            }
        }
        counts.push(divisor);

        const build = (lvl) => {
            if (lvl === -1) {
                pattern.push(0);
                return;
            }
            if (lvl === -2) {
                pattern.push(1);
                return;
            }
            for (let i = 0; i < counts[lvl]; i += 1) {
                build(lvl - 1);
            }
            if (remainders[lvl] !== 0) {
                build(lvl - 2);
            }
        };

        build(level);

        return pattern.slice(0, stepCount);
    }
}

window.PartitionsDistribution = PartitionsDistribution;
