# Deep Research Examples

This directory contains sample research reports and prompt templates for common use cases.

## Example Reports

### 1. Market Research
See `market-research-ai-assistants.md` for a comprehensive market analysis example.

### 2. Technical Deep Dive
See `technical-blockchain.md` for a technical research example.

### 3. Literature Review
See `literature-quantum-computing.md` for an academic literature review.

## Prompt Templates

### Quick Research
```
Research [TOPIC] with focus on:
- Current state and recent developments
- Key players/entities
- Main challenges and opportunities
- Future outlook

Depth: 2, Breadth: 2
```

### Comprehensive Analysis
```
Conduct a comprehensive analysis of [TOPIC]:

1. Executive Summary (200 words max)
2. Background and Context
3. Current Landscape
   - Key Players/Entities
   - Market Size/Adoption
   - Recent Developments
4. Technical/Strategic Analysis
5. Challenges and Risks
6. Future Outlook (2025-2030)
7. Recommendations
8. References

Use citations for all claims. Format as a professional report.

Depth: 4, Breadth: 4
```

### Comparative Analysis
```
Compare and contrast [OPTION A] vs [OPTION B]:

- Architecture and design philosophy
- Key features and capabilities
- Performance characteristics
- Use case fit
- Maturity and ecosystem
- Cost and operational considerations

Provide a recommendation matrix for different scenarios.

Depth: 3, Breadth: 3
```

### Technical Specification
```
Research and document [TECHNOLOGY]:

1. Technical Architecture
   - Core components
   - Data flow
   - Integration points
2. Implementation Details
   - Code examples
   - Best practices
   - Common patterns
3. Performance Considerations
4. Security Implications
5. Troubleshooting Guide

Include code snippets where applicable.

Depth: 3, Breadth: 4
```

### Academic/Literature Review
```
Conduct a literature review on [TOPIC]:

- Historical development
- Current theories and frameworks
- Key papers and their contributions
- Methodological approaches
- Gaps in literature
- Future research directions

Format with academic citations (author, year).

Depth: 5, Breadth: 3
```

## Format Instructions

You can steer the output format using the `format` parameter:

### Executive Brief
```
format: "Executive Summary (max 200 words), Key Findings (bullet points), Action Items"
```

### Technical Report
```
format: "Abstract, Introduction, Methodology, Results, Discussion, Conclusion, References"
```

### Decision Document
```
format: "Context, Options Analysis (pros/cons for each), Recommendation, Implementation Steps"
```

### News Briefing
```
format: "Headline Summary, Key Developments (chronological), Implications, Sources"
```