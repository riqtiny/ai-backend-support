import { parseClassificationResponse } from "./llm.service";

describe("parseClassificationResponse", () => {
  it("parses a valid OpenAI response", () => {
    const result = parseClassificationResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              category: "billing",
              suggested_reply:
                "Thank you for reaching out. We will review your invoice.",
            }),
          },
        },
      ],
    });

    expect(result).toEqual({
      category: "billing",
      suggestedReply:
        "Thank you for reaching out. We will review your invoice.",
    });
  });

  it("accepts a JSON object wrapped in a markdown fence", () => {
    const result = parseClassificationResponse({
      choices: [
        {
          message: {
            content:
              '```json\n{"category":"technical","suggested_reply":"We are checking this now."}\n```',
          },
        },
      ],
    });

    expect(result.category).toBe("technical");
  });

  it("rejects an unsupported category", () => {
    expect(() =>
      parseClassificationResponse({
        choices: [
          {
            message: {
              content: '{"category":"urgent","suggested_reply":"Hello"}',
            },
          },
        ],
      }),
    ).toThrow("unsupported ticket category");
  });

  it("rejects an empty draft", () => {
    expect(() =>
      parseClassificationResponse({
        choices: [
          {
            message: {
              content: '{"category":"general","suggested_reply":"   "}',
            },
          },
        ],
      }),
    ).toThrow("empty suggested reply");
  });
});
