Scenario 1: customers' morning/afternoon slots enforced

| Method | Avg driving (min) | vs nearest neighbour | Late stops (total) | Skipped stops (total) |
|---|---|---|---|---|
| import order | 372 | +77.8% | 226 | 0 |
| sorted by latitude | 286 | +37.0% | 190 | 0 |
| nearest neighbour | 209 | +0.0% | 141 | 0 |
| OR-Tools | 209 | -0.1% | 0 | 2 |

Scenario 2: no slots (any time 9:00-17:00), pure distance problem

| Method | Avg driving (min) | vs nearest neighbour | Late stops (total) | Skipped stops (total) |
|---|---|---|---|---|
| import order | 372 | +77.8% | 47 | 0 |
| sorted by latitude | 286 | +37.0% | 5 | 0 |
| nearest neighbour | 209 | +0.0% | 0 | 0 |
| OR-Tools | 194 | -7.2% | 0 | 0 |
