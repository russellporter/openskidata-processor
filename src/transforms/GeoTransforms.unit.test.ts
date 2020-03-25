import { featureCollection, lineString, point } from "@turf/helpers";
import { polygonEnclosing } from "./GeoTransforms";

describe("GeoTransforms", () => {
  describe("polygonEnclosing", () => {
    it("should generate a polygon that encloses a feature", () => {
      expect(polygonEnclosing(featureCollection([point([0, 0])])))
        .toMatchInlineSnapshot(`
        Object {
          "coordinates": Array [
            Array [
              Array [
                0.0022457882102988034,
                0,
              ],
              Array [
                0.0022026360195641814,
                -0.00043813154513520225,
              ],
              Array [
                0.002074837761850218,
                -0.0008594259406586534,
              ],
              Array [
                0.001867304652530773,
                -0.0012476930792196133,
              ],
              Array [
                0.0015880120726110844,
                -0.0015880120724128634,
              ],
              Array [
                0.0012476930793083817,
                -0.0018673046522068451,
              ],
              Array [
                0.0008594259406821985,
                -0.0020748377614056464,
              ],
              Array [
                0.00043813154512721813,
                -0.0022026360190357023,
              ],
              Array [
                1.3751486716526465e-19,
                -0.002245788209739566,
              ],
              Array [
                -0.00043813154512721786,
                -0.0022026360190357023,
              ],
              Array [
                -0.0008594259406821982,
                -0.0020748377614056464,
              ],
              Array [
                -0.001247693079308381,
                -0.0018673046522068451,
              ],
              Array [
                -0.0015880120726110842,
                -0.0015880120724128634,
              ],
              Array [
                -0.0018673046525307733,
                -0.0012476930792196133,
              ],
              Array [
                -0.0020748377618502183,
                -0.0008594259406586534,
              ],
              Array [
                -0.0022026360195641814,
                -0.00043813154513520225,
              ],
              Array [
                -0.0022457882102988034,
                0,
              ],
              Array [
                -0.0022026360195641806,
                0.0004381315451097578,
              ],
              Array [
                -0.002074837761850217,
                0.000859425940633209,
              ],
              Array [
                -0.0018673046525307714,
                0.001247693079206891,
              ],
              Array [
                -0.0015880120726110816,
                0.0015880120724001414,
              ],
              Array [
                -0.0012476930793083785,
                0.001867304652194123,
              ],
              Array [
                -0.0008594259406821938,
                0.002074837761392924,
              ],
              Array [
                -0.0004381315451272131,
                0.002202636019010258,
              ],
              Array [
                5.571437269317299e-18,
                0.0022457882097141214,
              ],
              Array [
                0.000438131545127224,
                0.002202636019010258,
              ],
              Array [
                0.0008594259406822043,
                0.002074837761392924,
              ],
              Array [
                0.0012476930793083878,
                0.001867304652194123,
              ],
              Array [
                0.0015880120726110899,
                0.0015880120724001414,
              ],
              Array [
                0.0018673046525307776,
                0.001247693079206891,
              ],
              Array [
                0.0020748377618502213,
                0.000859425940633209,
              ],
              Array [
                0.002202636019564183,
                0.0004381315451097578,
              ],
              Array [
                0.0022457882102988034,
                0,
              ],
            ],
          ],
          "type": "Polygon",
        }
      `);
    });

    it("should generate a polygon with a hole that encloses a looped line", () => {
      expect(
        polygonEnclosing(
          featureCollection([
            lineString([
              [0, 0],
              [0, 1],
              [1, 1],
              [1, 0],
              [0, 0]
            ])
          ])
        )
      ).toMatchInlineSnapshot(`
        Object {
          "coordinates": Array [
            Array [
              Array [
                -0.0022457882102988034,
                0,
              ],
              Array [
                -0.0022457882102988034,
                0.9999999999999887,
              ],
              Array [
                -0.0022026360195641814,
                1.0004380647863242,
              ],
              Array [
                -0.002074837761850218,
                1.0008592949334347,
              ],
              Array [
                -0.0018673046525307733,
                1.001247502812448,
              ],
              Array [
                -0.0015880120726110842,
                1.0015877698264593,
              ],
              Array [
                -0.001247693079308381,
                1.0018670197216828,
              ],
              Array [
                -0.0008594259406821982,
                1.002074521098004,
              ],
              Array [
                -0.00043813154512721786,
                1.002202299808085,
              ],
              Array [
                0,
                1.0022454453972678,
              ],
              Array [
                1,
                1.0022454453972678,
              ],
              Array [
                1.0004381315451272,
                1.002202299808085,
              ],
              Array [
                1.0008594259406822,
                1.002074521098004,
              ],
              Array [
                1.0012476930793084,
                1.0018670197216828,
              ],
              Array [
                1.001588012072611,
                1.0015877698264593,
              ],
              Array [
                1.0018673046525308,
                1.001247502812448,
              ],
              Array [
                1.0020748377618502,
                1.0008592949334347,
              ],
              Array [
                1.0022026360195642,
                1.0004380647863242,
              ],
              Array [
                1.0022457882102989,
                0.9999999999999887,
              ],
              Array [
                1.0022457882102989,
                0,
              ],
              Array [
                1.0022026360195642,
                -0.00043813154513520225,
              ],
              Array [
                1.0020748377618502,
                -0.0008594259406586534,
              ],
              Array [
                1.0018673046525308,
                -0.0012476930792196133,
              ],
              Array [
                1.001588012072611,
                -0.0015880120724128634,
              ],
              Array [
                1.0012476930793084,
                -0.0018673046522068451,
              ],
              Array [
                1.0008594259406822,
                -0.0020748377614056464,
              ],
              Array [
                1.0004381315451272,
                -0.0022026360190357023,
              ],
              Array [
                1,
                -0.002245788209739566,
              ],
              Array [
                1.3751486716526465e-19,
                -0.002245788209739566,
              ],
              Array [
                0,
                -0.002245788209739566,
              ],
              Array [
                -0.000028266551298530163,
                -0.0022430041974303453,
              ],
              Array [
                -0.00043813154512721786,
                -0.0022026360190357023,
              ],
              Array [
                -0.0004381315451272186,
                -0.0022026360190357023,
              ],
              Array [
                -0.00043813154512721883,
                -0.0022026360190357023,
              ],
              Array [
                -0.00056978604373815,
                -0.002162699063527105,
              ],
              Array [
                -0.0008594259406821982,
                -0.0020748377614056464,
              ],
              Array [
                -0.0008594259406821987,
                -0.0020748377614056464,
              ],
              Array [
                -0.0008594259406821995,
                -0.0020748377614056464,
              ],
              Array [
                -0.0012476930793083817,
                -0.0018673046522068451,
              ],
              Array [
                -0.0015880120726110847,
                -0.0015880120724128634,
              ],
              Array [
                -0.0017625699350608901,
                -0.0013753127016702628,
              ],
              Array [
                -0.0018673046525307733,
                -0.0012476930792196133,
              ],
              Array [
                -0.001875951865419084,
                -0.0012315152817732123,
              ],
              Array [
                -0.0020748377618502183,
                -0.0008594259406586534,
              ],
              Array [
                -0.0022026360195641814,
                -0.00043813154513520225,
              ],
              Array [
                -0.0022026360195641814,
                -0.00043813154513520225,
              ],
              Array [
                -0.0022026360195641814,
                -0.00043813154513520225,
              ],
              Array [
                -0.0022457882102988034,
                0,
              ],
              Array [
                -0.0022457882102988034,
                0,
              ],
            ],
            Array [
              Array [
                0.0022457882102988034,
                0.0022457882097141214,
              ],
              Array [
                0.9977542117897011,
                0.0022457882097141214,
              ],
              Array [
                0.9977542117897011,
                0.9977545530666672,
              ],
              Array [
                0.0022457882102988034,
                0.9977545530666672,
              ],
              Array [
                0.0022457882102988034,
                0.0022457882097141214,
              ],
            ],
          ],
          "type": "Polygon",
        }
      `);
    });

    it("should generate multipolygon that encloses two distant features", () => {
      expect(
        polygonEnclosing(featureCollection([point([0, 0]), point([1, 1])]))
      ).toMatchInlineSnapshot(`
        Object {
          "coordinates": Array [
            Array [
              Array [
                Array [
                  0.0022457882102988034,
                  0,
                ],
                Array [
                  0.0022026360195641814,
                  -0.00043813154513520225,
                ],
                Array [
                  0.002074837761850218,
                  -0.0008594259406586534,
                ],
                Array [
                  0.001867304652530773,
                  -0.0012476930792196133,
                ],
                Array [
                  0.0015880120726110844,
                  -0.0015880120724128634,
                ],
                Array [
                  0.0012476930793083817,
                  -0.0018673046522068451,
                ],
                Array [
                  0.0008594259406821985,
                  -0.0020748377614056464,
                ],
                Array [
                  0.00043813154512721813,
                  -0.0022026360190357023,
                ],
                Array [
                  1.3751486716526465e-19,
                  -0.002245788209739566,
                ],
                Array [
                  -0.00043813154512721786,
                  -0.0022026360190357023,
                ],
                Array [
                  -0.0008594259406821982,
                  -0.0020748377614056464,
                ],
                Array [
                  -0.001247693079308381,
                  -0.0018673046522068451,
                ],
                Array [
                  -0.0015880120726110842,
                  -0.0015880120724128634,
                ],
                Array [
                  -0.0018673046525307733,
                  -0.0012476930792196133,
                ],
                Array [
                  -0.0020748377618502183,
                  -0.0008594259406586534,
                ],
                Array [
                  -0.0022026360195641814,
                  -0.00043813154513520225,
                ],
                Array [
                  -0.0022457882102988034,
                  0,
                ],
                Array [
                  -0.0022026360195641806,
                  0.0004381315451097578,
                ],
                Array [
                  -0.002074837761850217,
                  0.000859425940633209,
                ],
                Array [
                  -0.0018673046525307714,
                  0.001247693079206891,
                ],
                Array [
                  -0.0015880120726110816,
                  0.0015880120724001414,
                ],
                Array [
                  -0.0012476930793083785,
                  0.001867304652194123,
                ],
                Array [
                  -0.0008594259406821938,
                  0.002074837761392924,
                ],
                Array [
                  -0.0004381315451272131,
                  0.002202636019010258,
                ],
                Array [
                  5.571437269317299e-18,
                  0.0022457882097141214,
                ],
                Array [
                  0.000438131545127224,
                  0.002202636019010258,
                ],
                Array [
                  0.0008594259406822043,
                  0.002074837761392924,
                ],
                Array [
                  0.0012476930793083878,
                  0.001867304652194123,
                ],
                Array [
                  0.0015880120726110899,
                  0.0015880120724001414,
                ],
                Array [
                  0.0018673046525307776,
                  0.001247693079206891,
                ],
                Array [
                  0.0020748377618502213,
                  0.000859425940633209,
                ],
                Array [
                  0.002202636019564183,
                  0.0004381315451097578,
                ],
                Array [
                  0.0022457882102988034,
                  0,
                ],
              ],
            ],
            Array [
              Array [
                Array [
                  1.0022457882102989,
                  0.9999999999999887,
                ],
                Array [
                  1.0022026360195642,
                  0.9995619351551944,
                ],
                Array [
                  1.0020748377618502,
                  0.9991407048416012,
                ],
                Array [
                  1.0018673046525308,
                  0.9987524967134234,
                ],
                Array [
                  1.001588012072611,
                  0.9984122294055032,
                ],
                Array [
                  1.0012476930793084,
                  0.998132979216371,
                ],
                Array [
                  1.0008594259406822,
                  0.997925477590885,
                ],
                Array [
                  1.0004381315451272,
                  0.9977976987143085,
                ],
                Array [
                  1,
                  0.9977545530666672,
                ],
                Array [
                  0.9995618684548726,
                  0.9977976987143085,
                ],
                Array [
                  0.9991405740593179,
                  0.997925477590885,
                ],
                Array [
                  0.9987523069206917,
                  0.998132979216371,
                ],
                Array [
                  0.9984119879273889,
                  0.9984122294055032,
                ],
                Array [
                  0.9981326953474692,
                  0.9987524967134234,
                ],
                Array [
                  0.9979251622381499,
                  0.9991407048416012,
                ],
                Array [
                  0.9977973639804358,
                  0.9995619351551944,
                ],
                Array [
                  0.9977542117897011,
                  0.9999999999999887,
                ],
                Array [
                  0.9977973639804358,
                  1.0004380647863242,
                ],
                Array [
                  0.9979251622381499,
                  1.0008592949334347,
                ],
                Array [
                  0.9981326953474692,
                  1.001247502812448,
                ],
                Array [
                  0.9984119879273889,
                  1.0015877698264593,
                ],
                Array [
                  0.9987523069206917,
                  1.0018670197216828,
                ],
                Array [
                  0.9991405740593179,
                  1.002074521098004,
                ],
                Array [
                  0.9995618684548728,
                  1.002202299808085,
                ],
                Array [
                  1,
                  1.0022454453972678,
                ],
                Array [
                  1.0004381315451272,
                  1.002202299808085,
                ],
                Array [
                  1.0008594259406822,
                  1.002074521098004,
                ],
                Array [
                  1.0012476930793084,
                  1.0018670197216828,
                ],
                Array [
                  1.001588012072611,
                  1.0015877698264593,
                ],
                Array [
                  1.0018673046525308,
                  1.001247502812448,
                ],
                Array [
                  1.0020748377618502,
                  1.0008592949334347,
                ],
                Array [
                  1.0022026360195642,
                  1.0004380647863242,
                ],
                Array [
                  1.0022457882102989,
                  0.9999999999999887,
                ],
              ],
            ],
          ],
          "type": "MultiPolygon",
        }
      `);
    });

    it("should generate polygon that encloses two nearby features", () => {
      expect(
        polygonEnclosing(
          featureCollection([point([0, 0]), point([0.00001, 0.00001])])
        )
      ).toMatchInlineSnapshot(`
        Object {
          "coordinates": Array [
            Array [
              Array [
                -0.0022457882102988034,
                0,
              ],
              Array [
                -0.0022026360195641814,
                -0.00043813154513520225,
              ],
              Array [
                -0.0020748377618502183,
                -0.0008594259406586534,
              ],
              Array [
                -0.0018673046525307733,
                -0.0012476930792196133,
              ],
              Array [
                -0.0015880120726110842,
                -0.0015880120724128634,
              ],
              Array [
                -0.001247693079308381,
                -0.0018673046522068451,
              ],
              Array [
                -0.0008594259406821982,
                -0.0020748377614056464,
              ],
              Array [
                -0.00043813154512721786,
                -0.0022026360190357023,
              ],
              Array [
                1.3751486716526465e-19,
                -0.002245788209739566,
              ],
              Array [
                0.00043813154512721813,
                -0.0022026360190357023,
              ],
              Array [
                0.0008594259406821985,
                -0.0020748377614056464,
              ],
              Array [
                0.0012476930793083817,
                -0.0018673046522068451,
              ],
              Array [
                0.0015880120726110844,
                -0.0015880120724128634,
              ],
              Array [
                0.0015925196155753114,
                -0.00158251961542098,
              ],
              Array [
                0.0015980120726110842,
                -0.0015780120724242124,
              ],
              Array [
                0.001877304652530773,
                -0.00123769307921824,
              ],
              Array [
                0.002084837761850218,
                -0.0008494259406700023,
              ],
              Array [
                0.002212636019564181,
                -0.00042813154513382886,
              ],
              Array [
                0.0022557882102988034,
                0.000009999999988651159,
              ],
              Array [
                0.0022126360195641828,
                0.00044813154511113114,
              ],
              Array [
                0.0020848377618502213,
                0.0008694259406473046,
              ],
              Array [
                0.0018773046525307777,
                0.0012576930791955423,
              ],
              Array [
                0.0015980120726110897,
                0.0015980120723887924,
              ],
              Array [
                0.0012576930793083876,
                0.0018773046521827741,
              ],
              Array [
                0.0008694259406822043,
                0.0020848377613815754,
              ],
              Array [
                0.000448131545127224,
                0.0022126360190116313,
              ],
              Array [
                0.000010000000000005571,
                0.0022557882097154944,
              ],
              Array [
                -0.00042813154512721306,
                0.0022126360190116313,
              ],
              Array [
                -0.0008494259406821939,
                0.0020848377613815754,
              ],
              Array [
                -0.0012376930793083787,
                0.0018773046521827741,
              ],
              Array [
                -0.0015780120726110818,
                0.0015980120723887924,
              ],
              Array [
                -0.001582519615575309,
                0.001592519615396909,
              ],
              Array [
                -0.0015880120726110816,
                0.0015880120724001414,
              ],
              Array [
                -0.0018673046525307714,
                0.001247693079206891,
              ],
              Array [
                -0.002074837761850217,
                0.000859425940633209,
              ],
              Array [
                -0.0022026360195641806,
                0.0004381315451097578,
              ],
              Array [
                -0.0022457882102988034,
                0,
              ],
            ],
          ],
          "type": "Polygon",
        }
      `);
    });
  });
});
