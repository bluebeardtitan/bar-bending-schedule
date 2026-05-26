/* =====================================================================
   shape-library.js  —  EMBEDDED default bar-shape library (AUTO-GENERATED)
   ---------------------------------------------------------------------
   Generated from bbs/shapes.json by bbs/build-shapes.js — do not hand-edit
   unless you only ever open the app from disk. Edit shapes.json instead and
   re-run:  node bbs/build-shapes.js
   ===================================================================== */
window.SHAPE_LIB_DEFAULT = [
  {
    "id": "straight",
    "label": "Straight (00)",
    "bs8666": "00 / 1",
    "formula": "L = A",
    "group": "quick",
    "segments": [
      {
        "pts": [
          [
            0,
            0.5
          ],
          [
            1,
            0.5
          ]
        ],
        "style": "straight"
      }
    ],
    "dims": [
      {
        "from": [
          0,
          0.5
        ],
        "to": [
          1,
          0.5
        ],
        "label": "A",
        "off": [
          0,
          -24
        ]
      }
    ]
  },
  {
    "id": "L",
    "label": "L-bar (11)",
    "bs8666": "11",
    "formula": "L = A + (B) - 0.5r - d",
    "group": "quick",
    "segments": [
      {
        "pts": [
          [
            1,
            0.08
          ],
          [
            0.04,
            0.08
          ],
          [
            0.04,
            1
          ]
        ],
        "style": "bend"
      }
    ],
    "dims": [
      {
        "from": [
          0.04,
          0.08
        ],
        "to": [
          1,
          0.08
        ],
        "label": "B",
        "off": [
          0,
          -16
        ]
      },
      {
        "from": [
          0.04,
          0.08
        ],
        "to": [
          0.04,
          1
        ],
        "label": "A",
        "off": [
          -16,
          0
        ]
      }
    ]
  },
  {
    "id": "angle15",
    "label": "Angled (15)",
    "bs8666": "15",
    "formula": "L = A + (C)",
    "group": "quick",
    "segments": [
      {
        "pts": [
          [
            0.05,
            0.05
          ],
          [
            0.45,
            0.62
          ],
          [
            1,
            0.62
          ]
        ],
        "style": "bend"
      }
    ],
    "dims": [
      {
        "from": [
          0.05,
          0.05
        ],
        "to": [
          0.05,
          0.62
        ],
        "label": "B",
        "off": [
          -16,
          0
        ]
      },
      {
        "from": [
          0.45,
          0.62
        ],
        "to": [
          1,
          0.62
        ],
        "label": "(C)",
        "off": [
          0,
          18
        ]
      }
    ]
  },
  {
    "id": "U",
    "label": "U-bar (21)",
    "bs8666": "21",
    "formula": "L = A + B + (C) - r - 2d",
    "group": "quick",
    "segments": [
      {
        "pts": [
          [
            0,
            0.05
          ],
          [
            0,
            1
          ],
          [
            1,
            1
          ],
          [
            1,
            0.05
          ]
        ],
        "style": "bend"
      }
    ],
    "dims": [
      {
        "from": [
          0,
          0.05
        ],
        "to": [
          0,
          1
        ],
        "label": "A",
        "off": [
          -16,
          0
        ]
      },
      {
        "from": [
          0,
          1
        ],
        "to": [
          1,
          1
        ],
        "label": "B",
        "off": [
          0,
          16
        ]
      },
      {
        "from": [
          1,
          0.05
        ],
        "to": [
          1,
          1
        ],
        "label": "(C)",
        "off": [
          16,
          0
        ]
      }
    ]
  },
  {
    "id": "valley25",
    "label": "Valley (25)",
    "bs8666": "25",
    "formula": "L = A + B + (E)",
    "group": "quick",
    "segments": [
      {
        "pts": [
          [
            0.05,
            0.08
          ],
          [
            0.32,
            0.85
          ],
          [
            0.68,
            0.85
          ],
          [
            0.95,
            0.08
          ]
        ],
        "style": "bend"
      }
    ],
    "dims": [
      {
        "from": [
          0.05,
          0.08
        ],
        "to": [
          0.05,
          0.85
        ],
        "label": "C",
        "off": [
          -16,
          0
        ]
      },
      {
        "from": [
          0.32,
          0.85
        ],
        "to": [
          0.68,
          0.85
        ],
        "label": "(E)",
        "off": [
          0,
          18
        ]
      },
      {
        "from": [
          0.95,
          0.08
        ],
        "to": [
          0.95,
          0.85
        ],
        "label": "D",
        "off": [
          16,
          0
        ]
      }
    ]
  },
  {
    "id": "crank",
    "label": "Cranked (26)",
    "bs8666": "26",
    "formula": "L = A + B + (C)",
    "group": "quick",
    "segments": [
      {
        "pts": [
          [
            0,
            0.85
          ],
          [
            0.35,
            0.85
          ],
          [
            0.65,
            0.15
          ],
          [
            1,
            0.15
          ]
        ],
        "style": "bend"
      }
    ],
    "dims": [
      {
        "from": [
          0,
          0.85
        ],
        "to": [
          1,
          0.85
        ],
        "label": "Span",
        "off": [
          0,
          18
        ]
      },
      {
        "from": [
          0.65,
          0.15
        ],
        "to": [
          0.65,
          0.85
        ],
        "label": "d",
        "off": [
          18,
          0
        ]
      }
    ]
  },
  {
    "id": "Z-31",
    "label": "Z-bar (31)",
    "bs8666": "31",
    "formula": "L = A + B + C + (D) - 1.5r - 3d",
    "group": "quick",
    "segments": [
      {
        "pts": [
          [
            0.06,
            0.08
          ],
          [
            0.06,
            0.42
          ],
          [
            0.94,
            0.42
          ],
          [
            0.94,
            1
          ]
        ],
        "style": "bend"
      }
    ],
    "dims": [
      {
        "from": [
          0.06,
          0.08
        ],
        "to": [
          0.5,
          0.08
        ],
        "label": "A",
        "off": [
          0,
          -16
        ]
      },
      {
        "from": [
          0.06,
          0.08
        ],
        "to": [
          0.06,
          0.42
        ],
        "label": "B",
        "off": [
          -16,
          0
        ]
      },
      {
        "from": [
          0.06,
          0.42
        ],
        "to": [
          0.94,
          0.42
        ],
        "label": "C",
        "off": [
          0,
          18
        ]
      },
      {
        "from": [
          0.94,
          0.42
        ],
        "to": [
          0.94,
          1
        ],
        "label": "(D)",
        "off": [
          16,
          0
        ]
      }
    ]
  },
  {
    "id": "hat-41",
    "label": "Hat (41)",
    "bs8666": "41",
    "formula": "L = A + B + C + D + (E) - 2r - 4d",
    "group": "quick",
    "segments": [
      {
        "pts": [
          [
            0.05,
            0.5
          ],
          [
            0.05,
            0.1
          ],
          [
            0.55,
            0.1
          ],
          [
            0.55,
            0.5
          ]
        ],
        "style": "bend"
      },
      {
        "pts": [
          [
            0.78,
            0.5
          ],
          [
            0.78,
            0.1
          ],
          [
            0.95,
            0.1
          ]
        ],
        "style": "bend"
      }
    ],
    "dims": [
      {
        "from": [
          0.05,
          0.1
        ],
        "to": [
          0.55,
          0.1
        ],
        "label": "A",
        "off": [
          0,
          -16
        ]
      },
      {
        "from": [
          0.05,
          0.1
        ],
        "to": [
          0.05,
          0.5
        ],
        "label": "B",
        "off": [
          -16,
          0
        ]
      },
      {
        "from": [
          0.78,
          0.1
        ],
        "to": [
          0.78,
          0.5
        ],
        "label": "D",
        "off": [
          16,
          0
        ]
      }
    ]
  },
  {
    "id": "stirrup",
    "label": "Stirrup (51)",
    "bs8666": "51",
    "formula": "L = 2(A + B + C) - 2.5r - 5d",
    "group": "quick",
    "segments": [
      {
        "comment": "main loop, open at top-right",
        "pts": [
          [
            1,
            0
          ],
          [
            0,
            0
          ],
          [
            0,
            1
          ],
          [
            1,
            1
          ],
          [
            1,
            0.16
          ]
        ],
        "style": "bend"
      },
      {
        "comment": "hook end 1 inward 135",
        "pts": [
          [
            1,
            0
          ],
          [
            0.84,
            0.21
          ]
        ],
        "style": "bend"
      },
      {
        "comment": "hook end 2 inward 135",
        "pts": [
          [
            1,
            0.16
          ],
          [
            0.84,
            0.37
          ]
        ],
        "style": "bend"
      }
    ],
    "dims": [
      {
        "from": [
          0,
          0
        ],
        "to": [
          1,
          0
        ],
        "label": "A",
        "off": [
          0,
          -16
        ]
      },
      {
        "from": [
          0,
          0
        ],
        "to": [
          0,
          1
        ],
        "label": "B",
        "off": [
          -16,
          0
        ]
      },
      {
        "from": [
          1,
          0
        ],
        "to": [
          0.84,
          0.21
        ],
        "label": "C",
        "off": [
          12,
          0
        ]
      }
    ]
  },
  {
    "id": "link-63",
    "label": "Square link (63)",
    "bs8666": "63",
    "formula": "L = 2A + 3B + 2(C) - 3r - 6d",
    "group": "quick",
    "segments": [
      {
        "comment": "closed square link",
        "pts": [
          [
            0.05,
            0.08
          ],
          [
            0.95,
            0.08
          ],
          [
            0.95,
            0.92
          ],
          [
            0.05,
            0.92
          ]
        ],
        "style": "bend",
        "closed": true
      }
    ],
    "dims": [
      {
        "from": [
          0.05,
          0.08
        ],
        "to": [
          0.95,
          0.08
        ],
        "label": "A",
        "off": [
          0,
          -16
        ]
      },
      {
        "from": [
          0.05,
          0.08
        ],
        "to": [
          0.05,
          0.92
        ],
        "label": "B",
        "off": [
          -16,
          0
        ]
      }
    ]
  },
  {
    "id": "chair",
    "label": "Chair (98)",
    "bs8666": "98",
    "formula": "L = A + 2B + C + (D) - 2r - 4d",
    "group": "quick",
    "iso": true,
    "fit": 200,
    "segments": [
      {
        "comment": "top bar A",
        "pts": [
          [
            0,
            90,
            0
          ],
          [
            200,
            90,
            0
          ]
        ],
        "style": "straight"
      },
      {
        "comment": "left leg/foot/hook",
        "pts": [
          [
            0,
            90,
            0
          ],
          [
            0,
            0,
            0
          ],
          [
            0,
            0,
            64
          ],
          [
            0,
            28,
            64
          ]
        ],
        "style": "bend"
      },
      {
        "comment": "right leg/foot/hook",
        "pts": [
          [
            200,
            90,
            0
          ],
          [
            200,
            0,
            0
          ],
          [
            200,
            0,
            64
          ],
          [
            200,
            28,
            64
          ]
        ],
        "style": "bend"
      }
    ],
    "dims": [
      {
        "iso": true,
        "from": [
          0,
          90,
          0
        ],
        "to": [
          200,
          90,
          0
        ],
        "label": "A",
        "off": [
          0,
          -16
        ]
      },
      {
        "iso": true,
        "from": [
          0,
          90,
          0
        ],
        "to": [
          0,
          0,
          0
        ],
        "label": "B",
        "off": [
          -16,
          0
        ]
      },
      {
        "iso": true,
        "from": [
          0,
          0,
          0
        ],
        "to": [
          0,
          0,
          64
        ],
        "label": "C",
        "off": [
          0,
          16
        ]
      },
      {
        "iso": true,
        "from": [
          0,
          0,
          64
        ],
        "to": [
          0,
          28,
          64
        ],
        "label": "(D)",
        "off": [
          -8,
          0
        ]
      }
    ]
  },
  {
    "id": "circle",
    "label": "Circle (75)",
    "bs8666": "75",
    "formula": "L = π(A - d) + B",
    "group": "quick",
    "generator": "circle",
    "dims": [
      {
        "from": [
          0.5,
          0.5
        ],
        "to": [
          1,
          0.5
        ],
        "label": "⌀"
      }
    ]
  },
  {
    "id": "spiral",
    "label": "Spiral (77)",
    "bs8666": "77",
    "formula": "L = Cn(A - d)",
    "group": "quick",
    "generator": "spiral",
    "turns": 3,
    "dims": [
      {
        "from": [
          0,
          0.5
        ],
        "to": [
          1,
          0.5
        ],
        "label": "⌀"
      }
    ]
  }
];
