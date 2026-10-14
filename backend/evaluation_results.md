Scenario 1: customers' morning/afternoon slots enforced

| Method | Avg driving (min) | vs nearest neighbour | Late stops (total) | Skipped stops (total) |
|---|---|---|---|---|
| import order | 372 | +75.5% | 206 | 0 |
| sorted by latitude | 286 | +34.9% | 191 | 0 |
| nearest neighbour | 212 | +0.0% | 166 | 0 |
| OR-Tools | 207 | -2.5% | 0 | 1 |

Scenario 2: no slots (any time 9:00-17:00), pure distance problem

| Method | Avg driving (min) | vs nearest neighbour | Late stops (total) | Skipped stops (total) |
|---|---|---|---|---|
| import order | 372 | +75.5% | 51 | 0 |
| sorted by latitude | 286 | +34.9% | 10 | 0 |
| nearest neighbour | 212 | +0.0% | 0 | 0 |
| OR-Tools | 194 | -8.5% | 0 | 0 |

Scenario 3: whole fleet, 5 drivers, ~55 orders/day over 10 days

| Assignment | Total driving, all drivers (min/day) | Orders on a route | Not served |
|---|---|---|---|
| Zone rule + OR-Tools per driver | 643 (+0.0%) | 53.6 | 1.4 |
| Fleet optimizer (OR-Tools) | 597 (-7.2%) | 53.8 | 1.2 |
