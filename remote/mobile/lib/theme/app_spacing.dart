import 'package:flutter/widgets.dart';

/// AppSpacing : Tokens d'espacement et de marges standardisés pour l'application mobile Antigravity.
abstract class AppSpacing {
  // Valeurs numériques brutes (const double pour EdgeInsets.symmetric etc.)
  static const double space2 = 2.0;
  static const double space4 = 4.0;
  static const double space6 = 6.0;
  static const double space8 = 8.0;
  static const double space10 = 10.0;
  static const double space12 = 12.0;
  static const double space14 = 14.0;
  static const double space16 = 16.0;
  static const double space20 = 20.0;
  static const double space24 = 24.0;
  static const double space32 = 32.0;

  // Gaps horizontaux
  static const gapW4 = SizedBox(width: 4);
  static const gapW6 = SizedBox(width: 6);
  static const gapW8 = SizedBox(width: 8);
  static const gapW10 = SizedBox(width: 10);
  static const gapW12 = SizedBox(width: 12);
  static const gapW16 = SizedBox(width: 16);
  static const gapW24 = SizedBox(width: 24);
  static const hGap10 = SizedBox(width: 10);

  // Gaps verticaux
  static const gapH4 = SizedBox(height: 4);
  static const gapH6 = SizedBox(height: 6);
  static const gapH8 = SizedBox(height: 8);
  static const gapH10 = SizedBox(height: 10);
  static const gapH12 = SizedBox(height: 12);
  static const gapH14 = SizedBox(height: 14);
  static const gapH16 = SizedBox(height: 16);
  static const gapH24 = SizedBox(height: 24);
  static const gapH32 = SizedBox(height: 32);
  static const vGap4 = SizedBox(height: 4);
  static const vGap8 = SizedBox(height: 8);
  static const vGap10 = SizedBox(height: 10);
  static const vGap12 = SizedBox(height: 12);
  static const vGap14 = SizedBox(height: 14);
  static const vGap16 = SizedBox(height: 16);

  // Paddings all
  static const paddingXs = EdgeInsets.all(4);
  static const paddingSm = EdgeInsets.all(8);
  static const paddingMd = EdgeInsets.all(12);
  static const paddingLg = EdgeInsets.all(16);
  static const paddingXl = EdgeInsets.all(24);

  static const edgeInsetsA2 = EdgeInsets.all(2);
  static const edgeInsetsA4 = EdgeInsets.all(4);
  static const edgeInsetsA8 = EdgeInsets.all(8);
  static const edgeInsetsA10 = EdgeInsets.all(10);
  static const edgeInsetsA12 = EdgeInsets.all(12);
  static const edgeInsetsA16 = EdgeInsets.all(16);
  static const edgeInsetsA20 = EdgeInsets.all(20);
  static const edgeInsetsA24 = EdgeInsets.all(24);

  // Paddings symétriques horizontaux
  static const paddingHorizontalXs = EdgeInsets.symmetric(horizontal: 4);
  static const paddingHorizontalSm = EdgeInsets.symmetric(horizontal: 8);
  static const paddingHorizontalMd = EdgeInsets.symmetric(horizontal: 12);
  static const paddingHorizontalLg = EdgeInsets.symmetric(horizontal: 16);
  static const paddingHorizontalXl = EdgeInsets.symmetric(horizontal: 24);

  // Paddings symétriques verticaux
  static const paddingVerticalXs = EdgeInsets.symmetric(vertical: 4);
  static const paddingVerticalSm = EdgeInsets.symmetric(vertical: 8);
  static const paddingVerticalMd = EdgeInsets.symmetric(vertical: 12);
  static const paddingVerticalLg = EdgeInsets.symmetric(vertical: 16);

  // Paddings composés
  static const paddingCard = EdgeInsets.symmetric(horizontal: 16, vertical: 12);
  static const paddingDialog = EdgeInsets.symmetric(horizontal: 20, vertical: 16);
  static const paddingInput = EdgeInsets.symmetric(horizontal: 12, vertical: 10);

  // Border Radii compatibles
  static const borderRadiusSm = BorderRadius.all(Radius.circular(6));
  static const borderRadiusMd = BorderRadius.all(Radius.circular(8));
  static const borderRadiusLg = BorderRadius.all(Radius.circular(12));
  static const borderRadiusXl = BorderRadius.all(Radius.circular(16));
  static const borderRadiusPill = BorderRadius.all(Radius.circular(999));
}
